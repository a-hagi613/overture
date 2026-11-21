import { Readable } from "node:stream";
import { createDeflateRaw } from "node:zlib";
import { z } from "zod";

const LOCAL_FILE_HEADER = 0x04_03_4b_50;
const DATA_DESCRIPTOR = 0x08_07_4b_50;
const CENTRAL_DIRECTORY = 0x02_01_4b_50;
const END_OF_CENTRAL_DIRECTORY = 0x06_05_4b_50;
const VERSION = 20;
const FLAG_DATA_DESCRIPTOR = 0x08;
const FLAG_UTF8 = 0x08_00;
const FLAGS = FLAG_DATA_DESCRIPTOR + FLAG_UTF8;
const METHOD_DEFLATE = 8;
const MAX_UINT32 = 0xff_ff_ff_ff;
const MAX_UINT16 = 0xff_ff;
const DOS_DATE_BASE_YEAR = 1980;
const DOS_TIME_HOUR = 2048;
const DOS_TIME_MINUTE = 32;
const DOS_DATE_YEAR = 512;
const DOS_DATE_MONTH = 32;

export interface ZipEntry {
  name: string;
  modifiedAt: Date;
  read: () => AsyncIterable<Uint8Array>;
}

interface DirectoryEntry {
  name: Uint8Array<ArrayBuffer>;
  crc: number;
  compressed: number;
  uncompressed: number;
  offset: number;
  time: number;
  date: number;
}

function dosStamp(at: Date) {
  const year = Math.max(DOS_DATE_BASE_YEAR, at.getFullYear());
  const month = at.getMonth() + 1;
  const day = at.getDate();

  return {
    date: (year - DOS_DATE_BASE_YEAR) * DOS_DATE_YEAR + month * DOS_DATE_MONTH + day,
    time:
      at.getHours() * DOS_TIME_HOUR +
      at.getMinutes() * DOS_TIME_MINUTE +
      Math.floor(at.getSeconds() / 2),
  };
}

function u16(value: number) {
  const bytes = new Uint8Array(2);

  new DataView(bytes.buffer).setUint16(0, value, true);

  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);

  new DataView(bytes.buffer).setUint32(0, value, true);

  return bytes;
}

function concat(parts: Uint8Array<ArrayBuffer>[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);

  let offset = 0;

  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }

  return joined;
}

function guardSize(name: string, value: number) {
  if (value > MAX_UINT32) {
    throw new Error(`The export's ${name} is larger than a single zip can hold.`);
  }

  return value;
}

async function* deflate(bytes: AsyncIterable<Uint8Array>) {
  const deflator = createDeflateRaw({ level: 6 });

  const source = Readable.from(bytes);

  source.on("error", (error: Error) => {
    deflator.destroy(error);
  });

  source.pipe(deflator);

  for await (const chunk of deflator) {
    yield new Uint8Array(z.instanceof(Uint8Array).parse(chunk));
  }
}

async function* counted(source: AsyncIterable<Uint8Array>, onChunk: (chunk: Uint8Array) => void) {
  for await (const chunk of source) {
    onChunk(chunk);

    yield chunk;
  }
}

function localHeader(name: Uint8Array<ArrayBuffer>, stamp: ReturnType<typeof dosStamp>) {
  return concat([
    u32(LOCAL_FILE_HEADER),
    u16(VERSION),
    u16(FLAGS),
    u16(METHOD_DEFLATE),
    u16(stamp.time),
    u16(stamp.date),
    u32(0),
    u32(0),
    u32(0),
    u16(name.length),
    u16(0),
    name,
  ]);
}

function centralHeader(entry: DirectoryEntry) {
  return concat([
    u32(CENTRAL_DIRECTORY),
    u16(VERSION),
    u16(VERSION),
    u16(FLAGS),
    u16(METHOD_DEFLATE),
    u16(entry.time),
    u16(entry.date),
    u32(entry.crc),
    u32(entry.compressed),
    u32(entry.uncompressed),
    u16(entry.name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(entry.offset),
    entry.name,
  ]);
}

/**
 * Write a zip archive entry by entry, deflating each one as it is read. Only
 * the directory (one small record per file) is kept in memory, so a mailbox of
 * any size streams through a bounded buffer.
 * @param entries The archive's files, in order.
 * @yields {Uint8Array} The archive's bytes.
 */
export async function* zipStream(entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>) {
  const directory: DirectoryEntry[] = [];

  let offset = 0;

  for await (const entry of entries) {
    const name = new Uint8Array(new TextEncoder().encode(entry.name));
    const stamp = dosStamp(entry.modifiedAt);
    const header = localHeader(name, stamp);
    const entryOffset = offset;

    yield header;
    offset = guardSize("size", offset + header.length);

    let crc = 0;
    let compressed = 0;
    let uncompressed = 0;

    const sized = counted(entry.read(), (chunk) => {
      crc = Bun.hash.crc32(chunk, crc);
      uncompressed = guardSize("file size", uncompressed + chunk.length);
    });

    for await (const chunk of deflate(sized)) {
      compressed = guardSize("compressed size", compressed + chunk.length);

      yield chunk;
      offset = guardSize("size", offset + chunk.length);
    }

    const descriptor = concat([u32(DATA_DESCRIPTOR), u32(crc), u32(compressed), u32(uncompressed)]);

    yield descriptor;
    offset = guardSize("size", offset + descriptor.length);

    directory.push({
      compressed,
      crc,
      date: stamp.date,
      name,
      offset: entryOffset,
      time: stamp.time,
      uncompressed,
    });
  }

  const directoryOffset = offset;

  for (const entry of directory) {
    const record = centralHeader(entry);

    yield record;
    offset = guardSize("size", offset + record.length);
  }

  const directorySize = offset - directoryOffset;

  if (directory.length > MAX_UINT16) {
    throw new Error("The export has more files than a single zip can hold.");
  }

  yield concat([
    u32(END_OF_CENTRAL_DIRECTORY),
    u16(0),
    u16(0),
    u16(directory.length),
    u16(directory.length),
    u32(directorySize),
    u32(directoryOffset),
    u16(0),
  ]);
}
