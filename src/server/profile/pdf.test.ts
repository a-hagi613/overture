import { describe, expect, test } from "bun:test";

import { hasPdfMagicBytes } from "./pdf.ts";

const encoder = new TextEncoder();

describe("the PDF header check", () => {
  test("accepts bytes that start with the PDF magic", () => {
    expect(hasPdfMagicBytes(encoder.encode("%PDF-1.7\n"))).toBe(true);
  });

  test("accepts a short preamble before the PDF magic", () => {
    expect(hasPdfMagicBytes(encoder.encode("\uFEFF\u0000%PDF-1.4\n"))).toBe(true);
  });

  test("refuses a spoofed file without the magic bytes", () => {
    expect(hasPdfMagicBytes(encoder.encode("<!doctype html><html></html>"))).toBe(false);
    expect(hasPdfMagicBytes(encoder.encode("PDF-1.7"))).toBe(false);
    expect(hasPdfMagicBytes(new Uint8Array())).toBe(false);
  });

  test("only searches the header, not the whole payload", () => {
    const payload = new Uint8Array(2048);
    const magic = encoder.encode("%PDF-");

    payload.set(magic, 1500);

    expect(hasPdfMagicBytes(payload)).toBe(false);
  });
});
