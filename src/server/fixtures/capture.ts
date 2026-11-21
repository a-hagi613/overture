import type { Page } from "playwright-core";
import { chromium } from "playwright-core";

import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";

import { assetExtension, formSignature, sanitiseFormHtml } from "./sanitise.ts";

export const ATS_NAMES = ["greenhouse", "lever", "ashby"] as const;

export type FixtureAts = (typeof ATS_NAMES)[number];

const MAX_ASSETS = 40;
const MAX_ASSET_BYTES = 5_000_000;
const ASSET_LINK = /(?<prefix>\s(?:href|src)\s*=\s*)"(?<value>[^"]*)"/giu;

export interface CaptureFixturesInput {
  ats: FixtureAts;
  applyUrls: string[];
}

export interface CapturedFixture {
  ats: FixtureAts;
  formSignature: string;
  objectKey: string;
  assets: number;
  sourceUrl: string;
  capturedAt: number;
}

export interface FixtureCaptureDeps {
  clock: Clock;
  objects: ObjectStore;
  providers: BrowserProviderRegistry;
}

const resourceUrl = (value: string, base: string) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
};

async function captureAssets(page: Page, objects: ObjectStore, prefix: string) {
  const urls = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.startsWith("http")),
  );

  const unique = [...new Set(urls)].slice(0, MAX_ASSETS);
  const stored = new Map<string, string>();

  await Promise.all(
    unique.map(async (url) => {
      const response = await page.request.get(url).catch(() => null);

      if (response === null || !response.ok()) {
        return;
      }

      const bytes = await response.body().catch(() => null);

      if (bytes === null || bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) {
        return;
      }

      const extension = assetExtension(response.headers()["content-type"] ?? "", url);

      if (extension === "js" || extension === "json") {
        return;
      }

      const filename = `${crypto.randomUUID().slice(0, 12)}.${extension}`;

      await objects.put(`${prefix}/assets/${filename}`, new Uint8Array(bytes));
      stored.set(url, `assets/${filename}`);
    }),
  );

  return stored;
}

function rewriteAssetLinks(html: string, base: string, assets: Map<string, string>) {
  return html.replaceAll(ASSET_LINK, (match, prefix: string, value: string) => {
    const absolute = resourceUrl(value, base);
    const replacement = absolute === null ? undefined : assets.get(absolute);

    return replacement === undefined ? match : `${prefix}"${replacement}"`;
  });
}

async function captureOne(deps: FixtureCaptureDeps, ats: FixtureAts, applyUrl: string) {
  const provider = deps.providers.pick();
  const attemptId = `capture-${crypto.randomUUID()}`;

  const browser = await provider.open({
    attemptId,
    country: "ca",
    profileId: null,
    timeoutMinutes: 15,
  });

  try {
    const cdp = await chromium.connectOverCDP(browser.cdpUrl);

    try {
      const context = cdp.contexts()[0] ?? (await cdp.newContext());
      const page = context.pages()[0] ?? (await context.newPage());

      await page.goto(applyUrl, { waitUntil: "load" });

      const raw = await page.content();
      const sanitised = sanitiseFormHtml(raw);
      const signature = formSignature(sanitised);
      const prefix = `fixtures/${ats}/${signature}`;
      const assets = await captureAssets(page, deps.objects, prefix);
      const html = rewriteAssetLinks(sanitised, applyUrl, assets);
      const capturedAt = deps.clock.now();

      await deps.objects.put(`${prefix}/form.html`, new TextEncoder().encode(html));
      await deps.objects.put(
        `${prefix}/meta.json`,
        new TextEncoder().encode(
          JSON.stringify(
            {
              assets: [...assets.values()],
              ats,
              capturedAt,
              formSignature: signature,
              sourceUrl: applyUrl,
            },
            null,
            2,
          ),
        ),
      );

      return {
        assets: assets.size,
        ats,
        capturedAt,
        formSignature: signature,
        objectKey: `${prefix}/form.html`,
        sourceUrl: applyUrl,
      } satisfies CapturedFixture;
    } finally {
      await cdp.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
    await provider.stop(browser.sessionId).catch(() => undefined);
  }
}

export async function captureFixtures(deps: FixtureCaptureDeps, input: CaptureFixturesInput) {
  return Promise.all(
    input.applyUrls.map(async (applyUrl) => captureOne(deps, input.ats, applyUrl)),
  );
}
