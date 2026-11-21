import type { Page } from "playwright-core";
import { chromium, errors } from "playwright-core";

import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { FormQuestion } from "../pipeline/send-plan.ts";
import type { BrowserProviderRegistry, RemoteBrowser } from "../dispatch/browser/provider.ts";

import { acquireBrowserSession } from "../dispatch/browser/session-slots.ts";
import { readAshbyQuestions } from "../dispatch/ats/ashby.ts";
import { readLeverQuestions } from "../dispatch/ats/lever.ts";
import { assetExtension, formSignature, sanitiseFormHtml } from "./sanitise.ts";

export const ATS_NAMES = ["greenhouse", "lever", "ashby"] as const;

export type FixtureAts = (typeof ATS_NAMES)[number];

export const FORM_FIELD_SELECTORS = {
  ashby: "#_systemfield_email, form.ashby-application-form input:not([type='hidden'])",
  greenhouse: "form input:not([type='hidden'])",
  lever: "form input:not([type='hidden'])",
} as const satisfies Record<FixtureAts, string>;

export const FORM_RENDER_TIMEOUT_MS = 20_000;
export const GOTO_TIMEOUT_MS = 30_000;
export const GOTO_ATTEMPTS = 2;

export class FormNotRenderedError extends Error {
  readonly code = "no_form_rendered";

  constructor(ats: FixtureAts) {
    super(
      `no_form_rendered: no ${ats} application form field appeared within ${String(FORM_RENDER_TIMEOUT_MS / 1000)}s; nothing was saved`,
    );
    this.name = "FormNotRenderedError";
  }
}

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
  questions: FormQuestion[];
  sourceUrl: string;
  capturedAt: number;
}

export interface FixtureCaptureDeps {
  clock: Clock;
  objects: ObjectStore;
  providers: BrowserProviderRegistry;
  gotoTimeoutMs?: number;
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

async function waitForForm(page: Page, ats: FixtureAts) {
  try {
    await page.waitForSelector(FORM_FIELD_SELECTORS[ats], {
      state: "attached",
      timeout: FORM_RENDER_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      throw new FormNotRenderedError(ats);
    }

    throw error;
  }
}

async function loadPage(page: Page, applyUrl: string, timeout: number, attempt = 1) {
  try {
    await page.goto(applyUrl, { timeout, waitUntil: "load" });
  } catch (error) {
    if (!(error instanceof errors.TimeoutError) || attempt >= GOTO_ATTEMPTS) {
      throw error;
    }

    await page.goto("about:blank", { timeout, waitUntil: "load" });
    await loadPage(page, applyUrl, timeout, attempt + 1);
  }
}

async function withFormPage<T>(
  deps: FixtureCaptureDeps,
  ats: FixtureAts,
  applyUrl: string,
  capture: (input: { page: Page; html: string; signature: string }) => Promise<T>,
) {
  const provider = deps.providers.pick();
  const attemptId = `capture-${crypto.randomUUID()}`;
  const releaseSlot = await acquireBrowserSession();
  let browser: RemoteBrowser | null = null;

  try {
    browser = await provider.open({
      attemptId,
      country: "ca",
      profileId: null,
      timeoutMinutes: 15,
    });

    const cdp = await chromium.connectOverCDP(browser.cdpUrl);

    try {
      const context = cdp.contexts()[0] ?? (await cdp.newContext());
      const page = context.pages()[0] ?? (await context.newPage());

      await loadPage(page, applyUrl, deps.gotoTimeoutMs ?? GOTO_TIMEOUT_MS);
      await waitForForm(page, ats);

      const raw = await page.content();
      const html = sanitiseFormHtml(raw);
      const signature = formSignature(html);

      return await capture({ html, page, signature });
    } finally {
      await cdp.close().catch(() => undefined);
    }
  } finally {
    if (browser !== null) {
      await browser.close().catch(() => undefined);
      await provider.stop(browser.sessionId).catch(() => undefined);
    }

    releaseSlot();
  }
}

async function captureOne(deps: FixtureCaptureDeps, ats: FixtureAts, applyUrl: string) {
  return withFormPage(deps, ats, applyUrl, async ({ page, html, signature }) => {
    const prefix = `fixtures/${ats}/${signature}`;
    const assets = await captureAssets(page, deps.objects, prefix);
    const rewritten = rewriteAssetLinks(html, applyUrl, assets);
    const capturedAt = deps.clock.now();

    await deps.objects.put(`${prefix}/form.html`, new TextEncoder().encode(rewritten));
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
      questions: ats === "lever" ? await readLeverQuestions(page) : await readAshbyQuestions(page),
      sourceUrl: applyUrl,
    } satisfies CapturedFixture;
  });
}

export async function captureFixtures(deps: FixtureCaptureDeps, input: CaptureFixturesInput) {
  return Promise.all(
    input.applyUrls.map(async (applyUrl) => captureOne(deps, input.ats, applyUrl)),
  );
}
