import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { ANNOTATION_ALLOWLIST } from "../src/shared/copy-allowlist.ts";

const ANNOTATION = /\bfig(?<suffix>ure)?\.?\s*\d|\bfolio\b|§|\bartboard\b|\bboard note\b/giu;

const BUNDLE_FILE = /\.(?<extension>css|html|js)$/u;

function bundleFiles(directory: string) {
  return readdirSync(directory, { encoding: "utf8", recursive: true })
    .map((entry) => join(directory, entry))
    .filter((path) => BUNDLE_FILE.test(path));
}

function allowlisted(around: string) {
  return ANNOTATION_ALLOWLIST.some((entry) => around.includes(entry.text));
}

const dist = join(process.cwd(), "dist");

if (!existsSync(dist)) {
  throw new Error("copy:check:dist: dist/ is missing; run `bun run build` first.");
}

const findings: string[] = [];

for (const file of bundleFiles(dist)) {
  const text = readFileSync(file, "utf8");

  for (const match of text.matchAll(ANNOTATION)) {
    const start = Math.max(0, match.index - 60);
    const around = text.slice(start, match.index + match[0].length + 60);

    if (!allowlisted(around)) {
      findings.push(`${relative(process.cwd(), file)}: ${match[0]}\n    …${around}…`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(
    `copy:check:dist: canvas annotations ship in the bundle (#307):\n\n${findings.join("\n\n")}\n\n` +
      "Delete the copy, or add a reasoned entry to src/shared/copy-allowlist.ts.",
  );
}

process.stdout.write("copy:check:dist: no canvas annotations in dist\n");
