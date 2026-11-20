import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const ELEMENT_SUFFIX = "aside>div:nth-of-type(2)>div:nth-of-type(1)";

const boxSchema = z.object({ h: z.number(), w: z.number(), x: z.number(), y: z.number() });

const referenceSchema = z.object({
  elements: z.array(z.object({ box: boxSchema, path: z.string() })),
  page: z.object({ height: z.number(), width: z.number() }),
});

type Box = z.infer<typeof boxSchema>;

const FACTORS = [16_777_216, 65_536, 256, 1] as const;

const POLYNOMIAL = 3_781_383_581;

const UNSIGNED_LIMIT = 4_294_967_296;

const unsignedOf = (value: number) => ((value % UNSIGNED_LIMIT) + UNSIGNED_LIMIT) % UNSIGNED_LIMIT;

function xor32(left: number, right: number) {
  let a = unsignedOf(left);
  let b = unsignedOf(right);
  let out = 0;
  let scale = 1;

  for (let bit = 0; bit < 32; bit += 1) {
    if (a % 2 !== b % 2) {
      out += scale;
    }

    a = Math.floor(a / 2);
    b = Math.floor(b / 2);
    scale *= 2;
  }

  return out;
}

function u32Of(bytes: Uint8Array, offset: number) {
  return FACTORS.reduce((total, factor, index) => total + (bytes[offset + index] ?? 0) * factor, 0);
}

const CRC_TABLE: number[] = [];

for (let index = 0; index < 256; index += 1) {
  let entry = index;

  for (let bit = 0; bit < 8; bit += 1) {
    entry = entry % 2 === 0 ? Math.floor(entry / 2) : xor32(POLYNOMIAL, Math.floor(entry / 2));
  }

  CRC_TABLE.push(entry);
}

function crc32Of(bytes: Uint8Array) {
  let crc = 0xff_ff_ff_ff;

  for (const byte of bytes) {
    const index = xor32(crc, byte) % 256;

    crc = xor32(Math.floor(crc / 256), CRC_TABLE[index] ?? 0);
  }

  return 0xff_ff_ff_ff - crc;
}

function chunkTypeIs(bytes: Uint8Array, type: string) {
  return [0, 1, 2, 3].every((index) => bytes[index] === type.codePointAt(index));
}

function paeth(left: number, up: number, topLeft: number) {
  const candidate = left + up - topLeft;
  const distanceLeft = Math.abs(candidate - left);
  const distanceUp = Math.abs(candidate - up);
  const distanceTopLeft = Math.abs(candidate - topLeft);

  if (distanceLeft <= distanceUp && distanceLeft <= distanceTopLeft) {
    return left;
  }

  return distanceUp <= distanceTopLeft ? up : topLeft;
}

function reconcilePixel(filter: number, value: number, left: number, up: number, topLeft: number) {
  if (filter === 1) {
    return value + left;
  }

  if (filter === 2) {
    return value + up;
  }

  if (filter === 3) {
    return value + Math.floor((left + up) / 2);
  }

  return filter === 4 ? value + paeth(left, up, topLeft) : value;
}

function unfilter(image: Uint8Array, width: number, height: number, channels: number) {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);

  for (let row = 0; row < height; row += 1) {
    const filter = image[row * (stride + 1)] ?? 0;
    const start = row * (stride + 1) + 1;

    for (let column = 0; column < stride; column += 1) {
      const value = image[start + column] ?? 0;
      const left = column >= channels ? (out[row * stride + column - channels] ?? 0) : 0;
      const up = row > 0 ? (out[(row - 1) * stride + column] ?? 0) : 0;

      const topLeft =
        row > 0 && column >= channels ? (out[(row - 1) * stride + column - channels] ?? 0) : 0;

      out[row * stride + column] = reconcilePixel(filter, value, left, up, topLeft);
    }
  }

  return out;
}

function decodePng(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  let position = 8;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;

  const compressed: number[] = [];

  while (position < bytes.length) {
    const length = u32Of(bytes, position);
    const type = bytes.subarray(position + 4, position + 8);

    if (chunkTypeIs(type, "IHDR")) {
      width = u32Of(bytes, position + 8);

      height = u32Of(bytes, position + 12);

      bitDepth = bytes[position + 16] ?? 0;

      colorType = bytes[position + 17] ?? 0;
    } else if (chunkTypeIs(type, "IDAT")) {
      for (const byte of bytes.subarray(position + 8, position + 8 + length)) {
        compressed.push(byte);
      }
    }

    position += length + 12;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `Unsupported PNG in ${path}: bit depth ${String(bitDepth)}, colour ${String(colorType)}`,
    );
  }

  const channels = colorType === 2 ? 3 : 4;
  const image = new Uint8Array(inflateSync(new Uint8Array(compressed)));

  return { channels, height, pixels: unfilter(image, width, height, channels), width };
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = new Uint8Array(4);

  for (const index of [0, 1, 2, 3] as const) {
    typeBytes[index] = type.codePointAt(index) ?? 0;
  }

  const crcInput = new Uint8Array(4 + data.length);

  crcInput.set(typeBytes);

  crcInput.set(data, 4);

  const out = new Uint8Array(12 + data.length);

  const view = new DataView(out.buffer);

  view.setUint32(0, data.length);

  out.set(typeBytes, 4);

  out.set(data, 8);

  view.setUint32(8 + data.length, crc32Of(crcInput));

  return out;
}

function encodePng(pixels: Uint8Array, width: number, height: number, channels: number) {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const header = new Uint8Array(13);

  const view = new DataView(header.buffer);

  view.setUint32(0, width);

  view.setUint32(4, height);

  header[8] = 8;
  header[9] = channels === 3 ? 2 : 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);

  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    raw.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }

  const compressed = new Uint8Array(deflateSync(raw, { level: 9 }));

  const chunks = [
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0)),
  ];

  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));

  let position = 0;

  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }

  return out;
}

function rectOfBox(box: Box) {
  const x = Math.round(box.x);
  const y = Math.round(box.y);

  return {
    height: Math.round(box.y + box.h) - y,
    width: Math.round(box.x + box.w) - x,
    x,
    y,
  };
}

function cropUsageBaseline(theme: string) {
  const base = `design/reference/home/1280-${theme}`;
  const reference = referenceSchema.parse(JSON.parse(readFileSync(`${base}.json`, "utf8")));
  const element = reference.elements.find((candidate) => candidate.path.endsWith(ELEMENT_SUFFIX));

  if (element === undefined) {
    throw new Error(`No Applications-left element found in the 1280 ${theme} board.`);
  }

  const source = decodePng(`${base}.png`);
  const rect = rectOfBox(element.box);
  const cropped = new Uint8Array(rect.width * rect.height * source.channels);

  for (let row = 0; row < rect.height; row += 1) {
    const start = ((rect.y + row) * source.width + rect.x) * source.channels;

    cropped.set(
      source.pixels.subarray(start, start + rect.width * source.channels),
      row * rect.width * source.channels,
    );
  }

  const target = join("design/reference/home", `1280-${theme}-usage.png`);

  writeFileSync(target, encodePng(cropped, rect.width, rect.height, source.channels));
  process.stdout.write(
    `cropped design/reference/home/1280-${theme}.png ${JSON.stringify(rect)} to ${target}\n`,
  );
}

for (const theme of ["light", "dark"] as const) {
  cropUsageBaseline(theme);
}
