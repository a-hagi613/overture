/**
 * Reads a request body without ever holding more than `limit` bytes in memory.
 *
 * A `content-length` header is a hint, not a promise: a caller can omit it or lie about it, and
 * reading `arrayBuffer()` first would buffer the whole stream before a size check can refuse it.
 * This reader stops (and cancels the stream) the moment the cap is passed, so an oversized
 * unauthenticated body costs one buffer of `limit` bytes, not the sender's chosen size.
 *
 * @param request The incoming request.
 * @param limit The largest body accepted, in bytes.
 * @returns The body bytes, or null when the body is larger than `limit`.
 */
export async function readBodyCapped(request: Request, limit: number) {
  const stream = request.body;

  if (stream === null) {
    return new Uint8Array(0);
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for await (const chunk of stream) {
    bytes += chunk.byteLength;

    if (bytes > limit) {
      return null;
    }

    chunks.push(chunk);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body satisfies Uint8Array<ArrayBuffer>;
}
