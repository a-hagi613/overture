import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import {
  marketingConfig,
  marketingRoot,
  PRERENDERED_MARKETING_PATHS,
  startAssetLayer,
  startOrigin,
  STATIC_ASSET_SECURITY_HEADERS,
} from "./marketing-worker.fixture.ts";
import {
  MARKETING_ROUTE_PATTERNS,
  matchesMarketingRoute,
} from "../../workers/marketing/src/routes.ts";

const config = marketingConfig();

const appPaths = [
  ...readFileSync("src/web/route-table.tsx", "utf8").matchAll(/path: "(?<path>[^"]+)"/gu),
].flatMap((match) => {
  const path = match.groups?.path;

  return path === undefined ? [] : [path.replaceAll(/:<param>[A-Za-z]+/gu, "sample")];
});

const bypassPaths = [
  "/api/health",
  "/api/auth/sign-in",
  "/api/auth/oauth2/callback/google",
  "/webhooks/stripe",
  "/internal/mail/inbound",
  "/assets/main-abc123.js",
  "/assets/main-abc123.css",
  "/sw.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/favicon.ico",
  "/__test__/turnstile-api.js",
];

function headersFor(text: string, rule: string) {
  const lines = text.split("\n");
  const start = lines.indexOf(rule);
  const headers: Record<string, string> = {};

  if (start === -1) {
    return headers;
  }

  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  ")) {
      break;
    }

    const separator = line.indexOf(": ");

    headers[line.slice(2, separator)] = line.slice(separator + 2);
  }

  return headers;
}

test("the Worker attaches only the prerendered marketing paths", () => {
  expect(config.routes.map((route) => route.pattern)).toEqual([...MARKETING_ROUTE_PATTERNS]);

  for (const route of config.routes) {
    expect(route.zone_name).toBe("tryoverture.com");
    expect(route.pattern.startsWith("tryoverture.com/"), route.pattern).toBe(true);
  }

  for (const path of PRERENDERED_MARKETING_PATHS) {
    expect(matchesMarketingRoute(path), path).toBe(true);
  }

  expect(matchesMarketingRoute("/pricing")).toBe(false);
});

test("no app or API path reaches the marketing Worker", () => {
  for (const path of appPaths) {
    if (path === "*" || PRERENDERED_MARKETING_PATHS.some((marketing) => marketing === path)) {
      continue;
    }

    expect(matchesMarketingRoute(path), path).toBe(false);
    expect(matchesMarketingRoute(`${path}?from=test`), path).toBe(false);
  }

  for (const path of bypassPaths) {
    expect(matchesMarketingRoute(path), path).toBe(false);
  }
});

test("deploys as static assets only, so serving a page never invokes a Worker", () => {
  expect(config.main).toBeUndefined();
  expect(config.assets.not_found_handling).toBe("none");
  expect(config.assets.html_handling).toBe("drop-trailing-slash");
  expect(config.workers_dev).toBe(false);
  expect(resolve("workers/marketing", config.assets.directory)).toBe(resolve(marketingRoot));

  for (const path of PRERENDERED_MARKETING_PATHS) {
    const page =
      path === "/"
        ? join(marketingRoot, "index.html")
        : join(marketingRoot, path.slice(1), "index.html");

    expect(existsSync(page), page).toBe(true);
    expect(resolve(page).startsWith(`${resolve(marketingRoot)}/`), page).toBe(true);
  }
});

test("the prerendered marketing pages serve while the origin is down", async () => {
  const origin = startOrigin();
  const assets = startAssetLayer(marketingRoot);

  try {
    expect((await fetch(origin.base)).status).toBe(503);

    const hitsBefore = origin.hits();

    const pages = await Promise.all(
      PRERENDERED_MARKETING_PATHS.map(async (path) => {
        const response = await fetch(`${assets.base}${path}`);

        return { html: await response.text(), path, status: response.status };
      }),
    );

    for (const page of pages) {
      expect(page.status, page.path).toBe(200);
      expect(page.html, page.path).toContain('<div id="root"><');
      expect(page.html, page.path).toMatch(/<style>[\s\S]{1000,}<\/style>/u);
      expect(page.html, page.path).not.toContain("theme-boot.js");
      expect(page.html, page.path).not.toMatch(
        /<link\b[^>]*rel="stylesheet"[^>]*href="\/assets\//u,
      );
    }

    expect(origin.hits()).toBe(hitsBefore);
  } finally {
    await origin.stop();
    await assets.stop();
  }
});

test("the marketing Worker sends the app's security headers", () => {
  const text = readFileSync(join(marketingRoot, "_headers"), "utf8");

  expect(headersFor(text, "/*")).toEqual({ ...STATIC_ASSET_SECURITY_HEADERS });
});
