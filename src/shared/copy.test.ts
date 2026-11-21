import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { ANNOTATION_ALLOWLIST } from "./copy-allowlist.ts";
import { copy } from "./copy.ts";

const ANNOTATION = /\bfig(?<suffix>ure)?\.?\s*\d|\bfolio\b|§|\bartboard\b|\bboard note\b/giu;

const SOURCE_KEY = /^\s*(?<key>(?:fig|folio)[A-Za-z0-9_]*)\s*:/gimu;

const JSON_KEY = /"(?<key>(?:fig|folio)[A-Za-z0-9_]*)"\s*:/giu;

function nearby(text: string, index: number, length: number) {
  const start = Math.max(0, index - 40);

  return text.slice(start, index + length + 40);
}

function unallowedAnnotations(text: string) {
  return [...text.matchAll(ANNOTATION)].flatMap((match) => {
    const around = nearby(text, match.index, match[0].length);

    return ANNOTATION_ALLOWLIST.some((entry) => around.includes(entry.text)) ? [] : [around];
  });
}

function webSources() {
  return readdirSync("src/web", { encoding: "utf8", recursive: true })
    .map((entry) => join("src/web", entry))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}

test("no copy string carries a canvas annotation", () => {
  const serialised = JSON.stringify(copy);
  const source = readFileSync("src/shared/copy.ts", "utf8");
  const findings = [...unallowedAnnotations(serialised), ...unallowedAnnotations(source)];

  expect(
    findings,
    "Canvas annotations must not ship (#307): delete them from copy.ts, or add a reasoned entry to copy-allowlist.ts.",
  ).toEqual([]);
});

test("no copy key is named after a canvas annotation", () => {
  const serialised = JSON.stringify(copy);
  const source = readFileSync("src/shared/copy.ts", "utf8");

  expect([...serialised.matchAll(JSON_KEY)].map((match) => match[0])).toEqual([]);
  expect([...source.matchAll(SOURCE_KEY)].map((match) => match[0].trim())).toEqual([]);
});

test("no src/web file outside the sign-in story reads copy.sample", () => {
  const offenders = webSources()
    .filter((file) => !file.includes("signin"))
    .filter((file) => readFileSync(file, "utf8").includes("copy.sample"));

  expect(offenders).toEqual([]);
});
