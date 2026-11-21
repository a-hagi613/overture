const MAGIC = new TextEncoder().encode("OVEXPRT1");
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
const COUNTER_BYTES = 4;
const LENGTH_BYTES = 4;
const MAX_CHUNKS = 2 ** (COUNTER_BYTES * 8);

/**
 * The plaintext chunk size of an export archive. Both the writer and the
 * reader use it so a download never holds more than one chunk in memory.
 */
export const EXPORT_CHUNK_BYTES = 1024 * 1024;

function base64UrlOf(bytes: Uint8Array<ArrayBuffer>) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/[=]+$/u, "");
}

function bytesOfBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");

  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }

  return bytes;
}

/**
 * A fresh 256-bit key for one export, encoded for a download link's fragment.
 * @returns base64url text (43 characters).
 */
export function newExportKey() {
  return base64UrlOf(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

function keyBytes(key: string) {
  let bytes: Uint8Array<ArrayBuffer>;

  try {
    bytes = bytesOfBase64Url(key.trim());
  } catch {
    throw new Error("The export key is not valid base64url.");
  }

  if (bytes.length !== KEY_BYTES) {
    throw new Error("The export key must be 32 bytes.");
  }

  return bytes;
}

function ivFor(nonce: Uint8Array<ArrayBuffer>, counter: number) {
  const iv = new Uint8Array(NONCE_BYTES);

  iv.set(nonce.subarray(0, NONCE_BYTES - COUNTER_BYTES));

  const view = new DataView(iv.buffer);

  view.setUint32(NONCE_BYTES - COUNTER_BYTES, counter, false);

  return iv;
}

function frameLengthOf(bytes: Uint8Array<ArrayBuffer>) {
  return new DataView(bytes.buffer, bytes.byteOffset, LENGTH_BYTES).getUint32(0, false);
}

function lengthFrame(length: number) {
  const bytes = new Uint8Array(LENGTH_BYTES);

  new DataView(bytes.buffer).setUint32(0, length, false);

  return bytes;
}

/**
 * The binary layout of an encrypted export: the 8-byte magic, a 12-byte nonce,
 * then frames of a 4-byte big-endian ciphertext length and AES-256-GCM
 * ciphertext with its 16-byte tag. Each chunk uses the nonce with its last four
 * bytes replaced by the chunk's counter.
 * @returns The header's size in bytes.
 */
export function exportHeaderLength() {
  return MAGIC.length + NONCE_BYTES;
}

export interface ExportWriter {
  header: Uint8Array<ArrayBuffer>;
  encrypt: (plain: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * Import a download key and prepare a writer that encrypts one chunk at a time.
 * @param key The link's base64url key.
 * @returns The archive header (write it first) and the per-chunk encryptor.
 */
export async function createExportWriter(key: string) {
  const aes = await crypto.subtle.importKey("raw", keyBytes(key), { name: "AES-GCM" }, false, [
    "encrypt",
  ]);

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  const header = new Uint8Array(MAGIC.length + NONCE_BYTES);

  header.set(MAGIC);
  header.set(nonce, MAGIC.length);

  let counter = 0;

  return {
    header,
    encrypt: async (plain) => {
      if (counter >= MAX_CHUNKS) {
        throw new Error("The export is larger than one key can encrypt.");
      }

      const chunk = counter;

      counter += 1;

      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: ivFor(nonce, chunk), additionalData: MAGIC },
          aes,
          plain,
        ),
      );

      const framed = new Uint8Array(LENGTH_BYTES + sealed.length);

      framed.set(lengthFrame(sealed.length));
      framed.set(sealed, LENGTH_BYTES);

      return framed;
    },
  } satisfies ExportWriter;
}

async function* chunksOf(source: AsyncIterable<Uint8Array>) {
  for await (const chunk of source) {
    yield new Uint8Array(chunk);
  }
}

/**
 * Decrypt an export archive as a stream, using the key from its download link.
 * A frame that is corrupt or out of order fails the whole download.
 * @param key The link's base64url key.
 * @param source The encrypted bytes.
 * @yields {Uint8Array} The next plaintext chunk.
 */
export async function* decryptExport(key: string, source: AsyncIterable<Uint8Array>) {
  const aes = await crypto.subtle.importKey("raw", keyBytes(key), { name: "AES-GCM" }, false, [
    "decrypt",
  ]);

  const headerBytes = exportHeaderLength();
  const buffer = new Uint8Array(headerBytes + LENGTH_BYTES + EXPORT_CHUNK_BYTES + TAG_BYTES);

  let filled = 0;
  let nonce: Uint8Array<ArrayBuffer> | null = null;
  let counter = 0;

  function takeHeader() {
    if (nonce !== null) {
      return;
    }

    if (filled < headerBytes) {
      return;
    }

    const magic = new TextDecoder().decode(buffer.subarray(0, MAGIC.length));

    if (magic !== new TextDecoder().decode(MAGIC)) {
      throw new Error("The export archive is not a valid encrypted export.");
    }

    nonce = buffer.slice(MAGIC.length, headerBytes);
  }

  async function* drainOne() {
    if (nonce === null || filled - headerBytes < LENGTH_BYTES) {
      return true;
    }

    const length = frameLengthOf(buffer.subarray(headerBytes, headerBytes + LENGTH_BYTES));

    if (length < TAG_BYTES || length > EXPORT_CHUNK_BYTES + TAG_BYTES) {
      throw new Error("The export archive is not a valid encrypted export.");
    }

    if (filled - headerBytes < LENGTH_BYTES + length) {
      return true;
    }

    const sealed = buffer.slice(headerBytes + LENGTH_BYTES, headerBytes + LENGTH_BYTES + length);

    yield new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivFor(nonce, counter), additionalData: MAGIC },
        aes,
        sealed,
      ),
    );

    counter += 1;

    buffer.copyWithin(headerBytes, headerBytes + LENGTH_BYTES + length, filled);
    filled -= LENGTH_BYTES + length;

    return false;
  }

  async function* drain() {
    await Promise.resolve();

    for (;;) {
      const done = yield* drainOne();

      if (done) {
        return;
      }
    }
  }

  for await (const chunk of chunksOf(source)) {
    let offset = 0;

    while (offset < chunk.length) {
      const room = buffer.length - filled;

      if (room === 0) {
        throw new Error("The export archive is not a valid encrypted export.");
      }

      const take = Math.min(room, chunk.length - offset);

      buffer.set(chunk.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;

      takeHeader();

      yield* drain();
    }
  }

  if (filled !== headerBytes) {
    throw new Error("The export archive ended before its last chunk.");
  }
}

/**
 * Adapt a fetch response body (or any byte stream) to an async iterable.
 * @param stream The byte stream.
 * @yields {Uint8Array} The next chunk the stream delivered.
 */
export async function* byteStream(stream: ReadableStream<Uint8Array>) {
  for await (const chunk of stream) {
    yield chunk;
  }
}
