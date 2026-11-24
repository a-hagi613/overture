import { readFileSync } from "node:fs";

import { expect, test } from "bun:test";

const stylesheet = readFileSync("src/web/styles.css", "utf8");

test("Tailwind scans only src/ and index.html, so every build context compiles the same CSS", () => {
  expect(stylesheet).toContain('@import "tailwindcss" source("../");');
  expect(stylesheet).toContain('@source "../../index.html";');
  expect(stylesheet.indexOf('@import "tailwindcss" source("../");')).toBeLessThan(
    stylesheet.indexOf("@theme {"),
  );
});

test("the stylesheet never falls back to the project-root scan that drifted the asset hashes", () => {
  expect(stylesheet).not.toMatch(/^@import "tailwindcss";$/mu);
  expect(stylesheet).not.toContain('source("./")');
});
