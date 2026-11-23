const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const PDF_HEADER_SEARCH_BYTES = 1024;

/**
 * Whether the bytes carry the `%PDF-` header a real PDF starts with. A browser
 * only reports the MIME type it was told, so this checks the file itself; some
 * writers put a short preamble before the header, so it is searched in the first
 * kilobyte rather than only at offset zero.
 * @param bytes The uploaded file.
 * @returns True when the PDF magic bytes are present in the header.
 */
export function hasPdfMagicBytes(bytes: Uint8Array) {
  const limit = Math.min(bytes.length, PDF_HEADER_SEARCH_BYTES);

  for (let start = 0; start + PDF_MAGIC.length <= limit; start += 1) {
    const matches = PDF_MAGIC.every((byte, offset) => bytes[start + offset] === byte);

    if (matches) {
      return true;
    }
  }

  return false;
}
