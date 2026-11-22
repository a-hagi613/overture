import { chromium } from "playwright-core";

import type { Page } from "playwright-core";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { LabOutcome, LabProvider, LabRunRecord } from "./store.ts";
import type { LabFormAts } from "./pages.ts";

import { logError } from "../platform/log.ts";
import { acquireBrowserSession } from "../dispatch/browser/session-slots.ts";
import { applySendProxyTrim } from "../dispatch/browser/proxy-trim.ts";
import { LAB_FORM_FIELDS, labPage } from "./pages.ts";
import { recordLabRun } from "./store.ts";

export const LAB_NAVIGATION_TIMEOUT_MS = 30_000;
export const LAB_STATUS_TIMEOUT_MS = 30_000;
const LAB_SESSION_TIMEOUT_MINUTES = 10;

const RESUME_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

const answerFor = (name: string) => {
  if (name.includes("email")) {
    return "maya.okafor@example.invalid";
  }

  if (name.includes("first_name") || name === "firstname") {
    return "Maya";
  }

  if (name.includes("last_name") || name === "lastname") {
    return "Okafor";
  }

  return "Maya Okafor";
};

export interface LabRunInput {
  challenge: "pass" | "blocked";
  providers: LabProvider[];
  pages: string[];
  sessionsPerPage: number;
}

export interface LabRunDeps {
  clock: Clock;
  db: AppDatabase;
  providers: BrowserProviderRegistry;
  baseUrl: string;
}

interface LabRunSession extends LabRunRecord {
  key: string;
}

interface LabRunSummary {
  runId: string;
  sessions: LabRunSession[];
}

interface Driven {
  outcome: LabOutcome;
  challengeSeen: boolean;
  codeAsked: boolean;
  captchaScore: number | null;
  errorCode: string | null;
}

const failed = (code: string) =>
  ({
    captchaScore: null,
    challengeSeen: false,
    codeAsked: false,
    errorCode: code,
    outcome: "error",
  }) satisfies Driven;

const statusOf = async (page: Page) =>
  await page
    .locator("[data-lab-status]")
    .getAttribute("data-lab-status", { timeout: LAB_STATUS_TIMEOUT_MS })
    .catch(() => null);

async function driveChallenge(
  page: Page,
  baseUrl: string,
  path: string,
  challenge: "pass" | "blocked",
) {
  const separator = path.includes("?") ? "&" : "?";

  await page.goto(`${baseUrl}${path}${separator}challenge=${challenge}`, {
    timeout: LAB_NAVIGATION_TIMEOUT_MS,
    waitUntil: "domcontentloaded",
  });

  await page
    .locator("[data-lab-status]")
    .waitFor({ state: "attached", timeout: LAB_STATUS_TIMEOUT_MS });

  const settled = await page
    .waitForFunction(
      () => {
        const status = document.querySelector<HTMLElement>("[data-lab-status]")?.dataset.labStatus;

        return status !== "waiting" && status !== undefined;
      },
      undefined,
      { timeout: LAB_STATUS_TIMEOUT_MS },
    )
    .then(async () => await statusOf(page))
    .catch(() => null);

  if (settled === "passed") {
    const rawScore = await page
      .locator("[data-lab-score]")
      .getAttribute("data-lab-score", { timeout: 1000 })
      .catch(() => null);

    const score = rawScore === null || rawScore === "" ? null : Number(rawScore);

    return {
      captchaScore: score !== null && Number.isFinite(score) ? score : null,
      challengeSeen: true,
      codeAsked: false,
      errorCode: null,
      outcome: "completed",
    } satisfies Driven;
  }

  if (settled === "blocked") {
    return {
      captchaScore: null,
      challengeSeen: true,
      codeAsked: false,
      errorCode: null,
      outcome: "challenge_blocked",
    } satisfies Driven;
  }

  const errorCode = settled === null ? "lab_status_timeout" : `lab_status_${settled}`;

  return { ...failed(errorCode), challengeSeen: true } satisfies Driven;
}

async function driveForm(page: Page, baseUrl: string, ats: LabFormAts) {
  const fields = LAB_FORM_FIELDS[ats];
  const upload = fields.find((field) => field.type === "file");
  const textFields = fields.filter((field) => field.type !== "file");

  await page.goto(`${baseUrl}/lab/forms/${ats}`, {
    timeout: LAB_NAVIGATION_TIMEOUT_MS,
    waitUntil: "domcontentloaded",
  });

  await page.locator("form").waitFor({ state: "visible", timeout: LAB_STATUS_TIMEOUT_MS });

  await series(textFields.length, async (index) => {
    const field = textFields[index];

    if (field !== undefined) {
      await page.fill(`[name="${field.name}"]`, answerFor(field.name), { timeout: 5000 });
    }
  });

  if (upload === undefined) {
    return failed("lab_unknown_ats");
  }

  await page.setInputFiles(
    `[name="${upload.name}"]`,
    { buffer: Buffer.from(RESUME_BYTES), mimeType: "application/pdf", name: "resume.pdf" },
    { timeout: 5000 },
  );

  await Promise.all([
    page.waitForURL(`**/lab/forms/${ats}/submit`, { timeout: LAB_STATUS_TIMEOUT_MS }),
    page.getByRole("button", { name: "Submit application" }).click({ timeout: 5000 }),
  ]);

  const confirmation = await page
    .locator("[data-lab-confirmation]")
    .waitFor({ state: "visible", timeout: LAB_STATUS_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);

  if (!confirmation) {
    return failed("lab_confirmation_missing");
  }

  return {
    captchaScore: null,
    challengeSeen: false,
    codeAsked: false,
    errorCode: null,
    outcome: "completed",
  } satisfies Driven;
}

async function drivePage(page: Page, baseUrl: string, key: string, challenge: "pass" | "blocked") {
  const definition = labPage(key);

  if (definition === null) {
    return failed("lab_unknown_page");
  }

  return definition.page === "form" && definition.ats !== null
    ? await driveForm(page, baseUrl, definition.ats)
    : await driveChallenge(page, baseUrl, definition.path, challenge);
}

async function runSession(
  deps: LabRunDeps,
  runId: string,
  key: string,
  providerId: LabProvider,
  challenge: "pass" | "blocked",
) {
  const definition = labPage(key);

  const provider = deps.providers.all().find((candidate) => candidate.id === providerId);

  if (provider === undefined) {
    return recordUnconfigured(deps, runId, key, providerId);
  }

  const releaseSlot = await acquireBrowserSession();
  const startedAt = deps.clock.now();
  let driven: Driven = failed("lab_not_run");
  let sessionId: string | null = null;
  let proxyBytes: number | null = null;
  let costMicros: number | null = null;

  try {
    const browser = await provider.open({
      attemptId: `lab-${runId}`,
      country: "ca",
      profileId: null,
      timeoutMinutes: LAB_SESSION_TIMEOUT_MINUTES,
    });

    ({ sessionId } = browser);

    try {
      const cdp = await chromium.connectOverCDP(browser.cdpUrl);

      try {
        const context = cdp.contexts()[0] ?? (await cdp.newContext());
        const page = context.pages()[0] ?? (await context.newPage());

        await applySendProxyTrim(context);

        driven = await drivePage(page, deps.baseUrl, key, challenge);
      } finally {
        await cdp.close().catch(() => undefined);
      }
    } finally {
      const usage = await browser.close().catch(() => null);

      proxyBytes = usage?.proxyBytes ?? null;
      costMicros = usage?.costMicros ?? null;
      await provider.stop(browser.sessionId).catch(() => undefined);
    }
  } catch (error) {
    logError("lab.session", error);
    driven = failed("lab_session_failed");
  } finally {
    releaseSlot();
  }

  const endedAt = deps.clock.now();

  const session = {
    ats: definition?.ats ?? null,
    captchaScore: driven.captchaScore,
    challengeSeen: driven.challengeSeen,
    codeAsked: driven.codeAsked,
    costMicros,
    durationMs: Math.max(1, endedAt - startedAt),
    endedAt,
    errorCode: driven.errorCode,
    key,
    outcome: driven.outcome,
    page: definition?.page ?? "form",
    provider: providerId,
    proxyBytes,
    sessionId,
    startedAt,
  } satisfies LabRunSession;

  recordLabRun(deps.db, deps.clock, runId, session);

  return session;
}

function recordUnconfigured(deps: LabRunDeps, runId: string, key: string, providerId: LabProvider) {
  const definition = labPage(key);
  const at = deps.clock.now();

  const session = {
    ats: definition?.ats ?? null,
    captchaScore: null,
    challengeSeen: false,
    codeAsked: false,
    costMicros: null,
    durationMs: 1,
    endedAt: at,
    errorCode: "lab_provider_unconfigured",
    key,
    outcome: "error",
    page: definition?.page ?? "form",
    provider: providerId,
    proxyBytes: null,
    sessionId: null,
    startedAt: at,
  } satisfies LabRunSession;

  recordLabRun(deps.db, deps.clock, runId, session);

  return session;
}

async function series<T>(count: number, run: (index: number) => Promise<T>) {
  const results: T[] = [];

  const next = async (index: number) => {
    if (index >= count) {
      return;
    }

    results.push(await run(index));

    await next(index + 1);
  };

  await next(0);

  return results;
}

export async function runLab(deps: LabRunDeps, input: LabRunInput) {
  const runId = crypto.randomUUID();

  const groups = input.pages.flatMap((key) =>
    input.providers.map((provider) => ({ key, provider })),
  );

  const sessions = await Promise.all(
    groups.map(
      async (group) =>
        await series(
          input.sessionsPerPage,
          async () => await runSession(deps, runId, group.key, group.provider, input.challenge),
        ),
    ),
  );

  return { runId, sessions: sessions.flat() } satisfies LabRunSummary;
}
