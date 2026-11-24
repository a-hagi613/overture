import { describe, expect, test } from "bun:test";

import { safeHttpUrl } from "./http-url.ts";

describe("safeHttpUrl", () => {
  test("keeps http and https URLs", () => {
    expect(safeHttpUrl("https://boards.example/jobs/42")).toBe("https://boards.example/jobs/42");
    expect(safeHttpUrl("http://boards.example/jobs/42")).toBe("http://boards.example/jobs/42");
    expect(safeHttpUrl("  https://boards.example/jobs/42  ")).toBe(
      "https://boards.example/jobs/42",
    );
  });

  test("refuses every scheme a browser could execute or that has no host", () => {
    expect(safeHttpUrl(["java", "script:alert(1)"].join(""))).toBeNull();
    expect(safeHttpUrl(["Java", "script:alert(1)"].join(""))).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
    expect(safeHttpUrl("mailto:jobs@example.test")).toBeNull();
  });

  test("refuses relative, blank and malformed values", () => {
    expect(safeHttpUrl("/jobs/42")).toBeNull();
    expect(safeHttpUrl("boards.example/jobs/42")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("   ")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});
