import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import {
  assetReferences,
  DEFAULT_MARKETING_DIR,
  parseArguments,
  readMarketingAssetReferences,
  verifyMarketingAssets,
} from "./verify-marketing-assets.ts";

const PAGE = `<!doctype html>
<html>
  <head>
    <link rel="preload" as="script" crossorigin href="/assets/rolldown-runtime-XKyaHtl9.js" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
    <link rel="icon" href="/icons/icon-192.png" />
    <script type="module" crossorigin src="/assets/main-DE9lOe0s.js"></script>
    <script type="module" crossorigin src="/assets/main-DE9lOe0s.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

test("assetReferences keeps only the /assets/ bundle, in document order, without duplicates", () => {
  expect(assetReferences(PAGE)).toStrictEqual([
    "/assets/rolldown-runtime-XKyaHtl9.js",
    "/assets/main-DE9lOe0s.js",
  ]);
});

test("readMarketingAssetReferences refuses a missing build instead of passing silently", () => {
  const directory = mkdtempSync(join(tmpdir(), "marketing-assets-"));

  expect(() => readMarketingAssetReferences(directory)).toThrow(/index\.html is missing/u);
});

test("readMarketingAssetReferences refuses a page with no bundle to hydrate", () => {
  const directory = mkdtempSync(join(tmpdir(), "marketing-assets-"));

  writeFileSync(join(directory, "index.html"), "<html><body>no bundle</body></html>");

  expect(() => readMarketingAssetReferences(directory)).toThrow(/references no \/assets\/ bundle/u);
});

test("readMarketingAssetReferences reads the built page", () => {
  const directory = mkdtempSync(join(tmpdir(), "marketing-assets-"));

  writeFileSync(join(directory, "index.html"), PAGE);

  expect(readMarketingAssetReferences(directory)).toStrictEqual([
    "/assets/rolldown-runtime-XKyaHtl9.js",
    "/assets/main-DE9lOe0s.js",
  ]);
});

test("every asset that answers with a body passes against the given origin", async () => {
  const requested: string[] = [];

  const result = await verifyMarketingAssets({
    baseUrl: "https://overture-web.fly.dev/",
    fetchAsset: async (url) => {
      await Promise.resolve();
      requested.push(url);

      return { bytes: 128, status: 200 };
    },
    references: ["/assets/main-DE9lOe0s.js"],
  });

  expect(requested).toStrictEqual(["https://overture-web.fly.dev/assets/main-DE9lOe0s.js"]);
  expect(result.problems).toStrictEqual([]);
  expect(result.checked).toStrictEqual([
    { bytes: 128, path: "/assets/main-DE9lOe0s.js", status: 200 },
  ]);
});

test("the production 404 names the asset and the origin that would not serve it", async () => {
  const result = await verifyMarketingAssets({
    baseUrl: "https://tryoverture.com",
    fetchAsset: async () => {
      await Promise.resolve();

      return { bytes: 0, status: 404 };
    },
    references: ["/assets/main-BxN-xjqx.js"],
  });

  expect(result.problems).toStrictEqual([
    "https://tryoverture.com/assets/main-BxN-xjqx.js answered HTTP 404",
  ]);
});

test("a 200 that carries no bytes is reported, because hydration still fails", async () => {
  const result = await verifyMarketingAssets({
    baseUrl: "https://tryoverture.com",
    fetchAsset: async () => {
      await Promise.resolve();

      return { bytes: 0, status: 200 };
    },
    references: ["/assets/main-DE9lOe0s.js"],
  });

  expect(result.problems).toStrictEqual([
    "https://tryoverture.com/assets/main-DE9lOe0s.js answered 200 with an empty body",
  ]);
});

test("a redeploy that is still propagating is retried before it fails the deploy", async () => {
  let attempts = 0;

  const result = await verifyMarketingAssets({
    attempts: 3,
    baseUrl: "https://tryoverture.com",
    fetchAsset: async () => {
      await Promise.resolve();
      attempts += 1;

      return attempts < 3 ? { bytes: 0, status: 404 } : { bytes: 64, status: 200 };
    },
    pauseMs: 0,
    references: ["/assets/main-DE9lOe0s.js"],
  });

  expect(attempts).toBe(3);
  expect(result.problems).toStrictEqual([]);
});

test("a reference that keeps failing is reported once, after every attempt", async () => {
  let attempts = 0;

  const result = await verifyMarketingAssets({
    attempts: 2,
    baseUrl: "https://tryoverture.com",
    fetchAsset: async () => {
      await Promise.resolve();
      attempts += 1;

      return { bytes: 0, status: 503 };
    },
    pauseMs: 0,
    references: ["/assets/main-DE9lOe0s.js"],
  });

  expect(attempts).toBe(2);
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toContain("HTTP 503");
});

test("a fetch that throws is reported against its URL instead of crashing the deploy step", async () => {
  const result = await verifyMarketingAssets({
    baseUrl: "https://overture-web.fly.dev",
    fetchAsset: async () => {
      await Promise.resolve();

      throw new Error("connect ECONNREFUSED");
    },
    references: ["/assets/main-DE9lOe0s.js"],
  });

  expect(result.problems).toStrictEqual([
    "https://overture-web.fly.dev/assets/main-DE9lOe0s.js could not be fetched: connect ECONNREFUSED",
  ]);
});

test("a fetch that throws is retried like any other failure", async () => {
  let attempts = 0;

  const result = await verifyMarketingAssets({
    attempts: 2,
    baseUrl: "https://overture-web.fly.dev",
    fetchAsset: async () => {
      await Promise.resolve();
      attempts += 1;

      if (attempts === 1) {
        throw new Error("socket hang up");
      }

      return { bytes: 32, status: 200 };
    },
    pauseMs: 0,
    references: ["/assets/main-DE9lOe0s.js"],
  });

  expect(attempts).toBe(2);
  expect(result.problems).toStrictEqual([]);
});

test("parseArguments requires a base origin and defaults the build directory", () => {
  expect(parseArguments([])).toStrictEqual({ kind: "error", message: "--base <url> is required" });

  expect(parseArguments(["--base", "https://tryoverture.com"])).toStrictEqual({
    kind: "options",
    options: {
      attempts: 1,
      baseUrl: "https://tryoverture.com",
      directory: DEFAULT_MARKETING_DIR,
    },
  });
});

test("parseArguments reads the retry count and the build directory", () => {
  expect(
    parseArguments([
      "--dir",
      "dist-marketing",
      "--base",
      "https://overture-web.fly.dev",
      "--attempts",
      "5",
    ]),
  ).toStrictEqual({
    kind: "options",
    options: {
      attempts: 5,
      baseUrl: "https://overture-web.fly.dev",
      directory: "dist-marketing",
    },
  });
});

test("parseArguments rejects a retry count that is not a positive whole number", () => {
  expect(parseArguments(["--base", "https://tryoverture.com", "--attempts", "0"])).toStrictEqual({
    kind: "error",
    message: "--attempts must be a positive integer",
  });

  expect(parseArguments(["--base", "https://tryoverture.com", "--attempts", "many"])).toStrictEqual(
    {
      kind: "error",
      message: "--attempts must be a positive integer",
    },
  );
});

test("parseArguments refuses a retry flag with no value", () => {
  expect(parseArguments(["--base", "https://tryoverture.com", "--attempts"])).toStrictEqual({
    kind: "error",
    message: "--attempts needs a value",
  });
});
