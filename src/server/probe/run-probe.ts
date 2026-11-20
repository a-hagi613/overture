import { chromium } from "playwright-core";

import type { Browser, Route } from "playwright-core";

import type { Clock } from "../platform/ports/clock.ts";

import { BrowserUseClient } from "../dispatch/browser/browser-use.ts";
import type { BrowserSession } from "../dispatch/browser/browser-use.ts";
import type { ProbeConsole } from "./console.ts";
import { probeGreenhouse } from "./greenhouse.ts";
import type { GreenhouseAttempt } from "./greenhouse.ts";
import { GREENHOUSE_BOARD_ORIGIN, postingUrl } from "./run-file.ts";
import type { RunFile, RunFilePosting } from "./run-file.ts";
import { openProbeDatabase, recordProbeForm } from "./store.ts";
import type { ProbeDatabase, ProbeFormRecord } from "./store.ts";

export const COST_GATE_USD = 0.03;
export const SESSION_TIMEOUT_MINUTES = 15;
export const PROBE_METADATA_PURPOSE = "early_cloud_probe";

const USAGE_SETTLE_INTERVAL_MS = 1000;
const USAGE_SETTLE_DEADLINE_MS = 120_000;

export class ProbeRefusedError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "ProbeRefusedError";
  }
}

export interface ProbeDeps {
  runFile: RunFile;
  confirm: boolean;
  apiKey: string | undefined;
  apiBaseUrl: string | undefined;
  databasePath: string;
  flyAppName: string | undefined;
  flyMachineId: string | undefined;
  postingUrlOrigin: string | undefined;
  clock: Clock;
  console: ProbeConsole;
}

export interface ProbeFormResult {
  id: string;
  postingUrl: string;
  company: string;
  title: string;
  confirmMode: boolean;
  outcome: string;
  submitted: boolean;
  confirmationSeen: boolean;
  codeAsked: boolean;
  proxyMb: number;
  browserMinutes: number;
  costUsd: number;
}

const unapprovedQuestions = (runFile: RunFile) => {
  const unapproved: string[] = [];

  for (const posting of runFile.postings) {
    for (const question of posting.questions) {
      if (!question.approved) {
        unapproved.push(`${posting.company} / ${question.id}`);
      }
    }
  }

  return unapproved;
};

const toPositiveNumber = (raw: string | null | undefined) => {
  const parsed = Number(raw ?? 0);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const minutesBetween = (startedAt: string, finishedAt: string | null | undefined) => {
  if (finishedAt === null || finishedAt === undefined) {
    return 0;
  }

  const millis = Date.parse(finishedAt) - Date.parse(startedAt);

  return Number.isFinite(millis) && millis > 0 ? millis / 60_000 : 0;
};

const routeHandler = async (route: Route) => {
  const resourceType = route.request().resourceType();

  if (resourceType === "image" || resourceType === "font" || resourceType === "media") {
    try {
      await route.abort();
    } catch {}

    return;
  }

  await route.fallback();
};

const attemptOutcome = (attempt: GreenhouseAttempt | null, fallback: string) => {
  if (attempt === null) {
    return fallback;
  }

  return attempt.outcome === "fill_failed"
    ? `fill_failed: ${attempt.failedIds.join(", ")}`
    : attempt.outcome;
};

const settledUsage = (view: BrowserSession) =>
  toPositiveNumber(view.proxyUsedMb) > 0 && toPositiveNumber(view.proxyCost) > 0;

const readSession = async (client: ReturnType<typeof BrowserUseClient>, sessionId: string) => {
  try {
    return await client.getSession(sessionId);
  } catch {
    return null;
  }
};

const finalSessionView = async (
  client: ReturnType<typeof BrowserUseClient>,
  sessionId: string,
  clock: Clock,
) => {
  const deadline = clock.now() + USAGE_SETTLE_DEADLINE_MS;

  const readUntilSettled = async (view: BrowserSession | null) => {
    if ((view !== null && settledUsage(view)) || clock.now() >= deadline) {
      return view;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, USAGE_SETTLE_INTERVAL_MS);
    });

    return readUntilSettled(await readSession(client, sessionId));
  };

  return readUntilSettled(await readSession(client, sessionId));
};

export async function runProbe(deps: ProbeDeps) {
  if (deps.flyAppName === undefined && deps.flyMachineId === undefined) {
    throw new ProbeRefusedError(
      "refusing: the probe runs only on Fly (FLY_APP_NAME or FLY_MACHINE_ID is not set), never from a development machine",
    );
  }

  if (deps.apiKey === undefined) {
    throw new ProbeRefusedError("refusing: BROWSER_USE_API_KEY is not set");
  }

  const unapproved = unapprovedQuestions(deps.runFile);

  if (unapproved.length > 0) {
    throw new ProbeRefusedError(
      `refusing: ${String(unapproved.length)} answer(s) are not marked approved: ${unapproved.join(", ")}`,
    );
  }

  const client = BrowserUseClient(deps.apiKey, deps.apiBaseUrl);
  const { db } = openProbeDatabase(deps.databasePath);
  const results: ProbeFormResult[] = [];

  const runFrom = async (index: number) => {
    const posting = deps.runFile.postings[index];

    if (posting === undefined) {
      return results;
    }

    results.push(await runPosting(deps, client, db, posting, index));

    return runFrom(index + 1);
  };

  const finished = await runFrom(0);

  printSummary(deps, finished);

  return finished;
}

async function runPosting(
  deps: ProbeDeps,
  client: ReturnType<typeof BrowserUseClient>,
  db: ProbeDatabase["db"],
  posting: RunFilePosting,
  index: number,
) {
  const io = deps.console;
  const label = `posting ${String(index + 1)} (${posting.company} — ${posting.title})`;
  let session: BrowserSession | null = null;
  let browser: Browser | null = null;
  let attempt: Awaited<ReturnType<typeof probeGreenhouse>> | null = null;
  let outcome = "browser_error";

  io.writeLine(
    `${label}: starting a Browser Use session (residential exit in ${deps.runFile.country}, solver on, ${String(SESSION_TIMEOUT_MINUTES)}-minute timeout)`,
  );

  try {
    session = await client.createSession({
      proxyCountryCode: deps.runFile.country,
      timeoutMinutes: SESSION_TIMEOUT_MINUTES,
      solveCaptchas: true,
      metadata: { purpose: PROBE_METADATA_PURPOSE, posting: String(index + 1) },
    });

    const { cdpUrl } = session;

    if (cdpUrl === null || cdpUrl === undefined) {
      throw new Error("the session has no CDP URL");
    }

    browser = await chromium.connectOverCDP(cdpUrl);

    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    await context.route("**/*", routeHandler);

    attempt = await probeGreenhouse(
      page,
      posting,
      postingUrl(posting, deps.postingUrlOrigin ?? GREENHOUSE_BOARD_ORIGIN),
      deps.runFile.resumePath,
      io,
      deps.confirm,
    );
  } catch (error) {
    outcome = error instanceof Error ? `error: ${error.message}` : "error: unknown";

    io.writeLine(`${label}: ${outcome}`);
  } finally {
    if (browser !== null) {
      await browser.close().catch(() => undefined);
    }

    if (session !== null) {
      try {
        await client.stopSession(session.id);

        io.writeLine(`${label}: session stopped through the API`);
      } catch {
        io.writeLine(`${label}: stopping the session through the API failed`);
      }
    }
  }

  let view: BrowserSession | null = null;

  if (session !== null) {
    view = await finalSessionView(client, session.id, deps.clock);
  }

  const proxyMb = toPositiveNumber(view === null ? null : view.proxyUsedMb);
  const browserCost = toPositiveNumber(view === null ? null : view.browserCost);
  const proxyCost = toPositiveNumber(view === null ? null : view.proxyCost);

  const browserMinutes =
    view === null ? 0 : minutesBetween(view.startedAt, view.finishedAt ?? view.startedAt);

  const sent = attempt?.outcome === "sent" || attempt?.outcome === "unconfirmed";

  const result: ProbeFormResult = {
    id: crypto.randomUUID(),
    postingUrl: postingUrl(posting, GREENHOUSE_BOARD_ORIGIN),
    company: posting.company,
    title: posting.title,
    confirmMode: deps.confirm,
    outcome: attemptOutcome(attempt, outcome),
    submitted: sent,
    confirmationSeen: attempt?.confirmationSeen === true,
    codeAsked: attempt?.codeAsked === true,
    proxyMb,
    browserMinutes,
    costUsd: proxyCost + browserCost,
  };

  const record: ProbeFormRecord = {
    ...result,
    submitResponseStatus: attempt === null ? null : attempt.submitResponseStatus,
    sessionId: session === null ? null : session.id,
    createdAt: deps.clock.now(),
  };

  recordProbeForm(db, record);

  io.writeLine(
    `${label}: ${result.outcome} — proxy ${result.proxyMb.toFixed(2)} MB, browser ${result.browserMinutes.toFixed(2)} min, cost $${result.costUsd.toFixed(4)}, code asked: ${result.codeAsked ? "yes" : "no"}`,
  );

  return result;
}

function printSummary(deps: ProbeDeps, results: ProbeFormResult[]) {
  const io = deps.console;
  const spend = results.reduce((total, result) => total + result.costUsd, 0);
  const completed = results.filter((result) => result.outcome === "sent").length;
  const projected = completed > 0 ? spend / completed : spend;

  io.writeLine("");
  io.writeLine("early cloud probe summary");
  io.writeLine("");

  for (const result of results) {
    io.writeLine(
      `${result.company} — ${result.title}: ${result.outcome}, proxy ${result.proxyMb.toFixed(2)} MB, browser ${result.browserMinutes.toFixed(2)} min, cost $${result.costUsd.toFixed(4)}, code asked: ${result.codeAsked ? "yes" : "no"}, confirmation: ${result.confirmationSeen ? "seen" : "none"}`,
    );
  }

  io.writeLine("");

  if (!deps.confirm) {
    const filled = results.filter((result) => result.outcome === "dry_run_filled").length;

    if (filled === results.length) {
      io.writeLine(
        "dry run: every form was filled and the run stopped before submit; nothing was sent",
      );

      return;
    }

    io.writeLine(
      `dry run: ${String(filled)} of ${String(results.length)} forms were filled and the run stopped before submit; nothing was sent`,
    );

    for (const [index, result] of results.entries()) {
      const posting = deps.runFile.postings[index];

      if (posting === undefined || result.outcome === "dry_run_filled") {
        continue;
      }

      io.writeLine(
        `not filled: ${result.company} — ${result.title} (board ${posting.board}, job ${posting.jobId}): ${result.outcome}`,
      );
    }

    return;
  }

  io.writeLine(
    `projected cost per completed application: $${projected.toFixed(4)} against the $${COST_GATE_USD.toFixed(2)} gate (${String(completed)} completed of ${String(results.length)} submitted)`,
  );

  if (projected > COST_GATE_USD) {
    io.writeLine(
      "the gate is missed: open a follow-up on the $0.03 cost gate before building the pipeline on this",
    );
  } else {
    io.writeLine("the gate is met for this run");
  }
}
