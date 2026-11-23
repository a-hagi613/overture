import { describe, expect, test } from "bun:test";

import { safeFilename } from "./safe-filename.ts";

describe("a filename placed in a Content-Disposition header", () => {
  test("drops quotes, backslashes, CR and LF so the header cannot be broken", () => {
    expect(safeFilename('in"voice\\cover\r\nletter.pdf')).toBe("invoicecoverletter.pdf");
  });

  test("falls back to the caller's name when nothing safe remains", () => {
    expect(safeFilename('"')).toBe("attachment");
    expect(safeFilename("\r\n")).toBe("attachment");
    expect(safeFilename("", "resume.pdf")).toBe("resume.pdf");
  });

  test("keeps an ordinary name and bounds a very long one", () => {
    expect(safeFilename("Ada Rivera résumé.pdf")).toBe("Ada Rivera résumé.pdf");
    expect(safeFilename("a".repeat(400))).toHaveLength(180);
  });
});
