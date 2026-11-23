import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, test } from "@playwright/test";

const webRoot = join(import.meta.dirname, "..", "..", "src", "web");

const sourceFiles = readdirSync(webRoot, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.tsx?$/u.test(path) && !/\.test\.tsx?$/u.test(path))
  .map((path) => join(webRoot, path));

const stylesheet = readFileSync(join(webRoot, "styles.css"), "utf8");

const definedColors = new Set(
  [...stylesheet.matchAll(/--color-(?<name>[a-z0-9-]+)\s*:/gu)].map(
    (match) => match.groups?.name ?? "",
  ),
);

const definedTextSizes = new Set(
  [...stylesheet.matchAll(/--text-(?<name>[a-z0-9-]+)\s*:/gu)]
    .map((match) => match.groups?.name ?? "")
    .filter((name) => !name.includes("--")),
);

const definedShadows = new Set(
  [...stylesheet.matchAll(/--shadow-(?<name>[a-z0-9-]+)\s*:/gu)].map(
    (match) => match.groups?.name ?? "",
  ),
);

const builtIns = new Set([
  "transparent",
  "current",
  "inherit",
  "white",
  "black",
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "left",
  "center",
  "right",
  "justify",
  "start",
  "end",
  "wrap",
  "nowrap",
  "balance",
  "pretty",
  "ellipsis",
  "clip",
  "solid",
  "dashed",
  "dotted",
  "double",
  "none",
  "collapse",
  "separate",
  "spacing",
  "x",
  "y",
  "t",
  "b",
  "l",
  "r",
  "s",
  "e",
  "cover",
  "contain",
  "auto",
  "fixed",
  "local",
  "scroll",
  "repeat",
  "no-repeat",
  "top",
  "bottom",
  "gradient-to-r",
  "gradient-to-l",
  "gradient-to-t",
  "gradient-to-b",
  "linear",
  "radial",
  "conic",
  "origin",
  "blend",
  "clip",
  "none",
  "hidden",
  "inset",
  "offset",
  "opacity",
]);

const utility =
  /(?<![\w-])(?<prefix>text|bg|border|ring|fill|stroke|outline|divide|decoration|from|to|via|shadow)-(?<token>[a-z][a-z0-9-]*)(?![\w[(-]|\/\[)/gu;

function colorTokenFor(prefix: string, token: string) {
  if (prefix === "border" || prefix === "divide") {
    return token.replace(/^[tblrxyse]-/u, "");
  }

  if (prefix === "ring") {
    return token.replace(/^offset-/u, "");
  }

  return token;
}

function offenders() {
  const found: string[] = [];

  for (const path of sourceFiles) {
    const source = readFileSync(path, "utf8");

    for (const match of source.matchAll(utility)) {
      const prefix = match.groups?.prefix ?? "";
      const token = match.groups?.token ?? "";

      if (prefix === "text" && definedTextSizes.has(token)) {
        continue;
      }

      if (prefix === "shadow" && definedShadows.has(token)) {
        continue;
      }

      const colorToken = colorTokenFor(prefix, token);
      const base = colorToken.replace(/-\d+$/u, "");

      if (
        definedColors.has(colorToken) ||
        builtIns.has(token) ||
        builtIns.has(colorToken) ||
        builtIns.has(base) ||
        /^\d+$/u.test(colorToken)
      ) {
        continue;
      }

      found.push(`${relative(webRoot, path)}: ${match[0]}`);
    }
  }

  return found;
}

test("defines the primary button ink", () => {
  expect(definedColors.has("primary-ink")).toBe(true);
});

test("every colour utility in src/web names a defined theme token", () => {
  expect(offenders()).toEqual([]);
});
