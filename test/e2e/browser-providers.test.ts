import { chromium } from "playwright-core";
import { expect, test } from "@playwright/test";

import type { BrowserProvider } from "../../src/server/dispatch/browser/provider.ts";
import type { BrowserUseFixture, BrowserUseFixtureOptions } from "./browser-use-server.fixture.ts";

import { BrowserUseClient } from "../../src/server/dispatch/browser/browser-use.ts";
import { createBrowserUseBrowserProvider } from "../../src/server/dispatch/browser/browser-use-provider.ts";
import { KernelClient } from "../../src/server/dispatch/browser/kernel.ts";
import { createKernelBrowserProvider } from "../../src/server/dispatch/browser/kernel-provider.ts";
import { createBrowserProfileStore } from "../../src/server/dispatch/browser/profiles.ts";
import { applySendProxyTrim } from "../../src/server/dispatch/browser/proxy-trim.ts";
import { ProviderUnavailableError } from "../../src/server/dispatch/browser/provider.ts";
import { openDatabase } from "../../src/server/platform/db/client.ts";
import { migrateDatabase } from "../../src/server/platform/db/migrate.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";
import { RetryLaterError } from "../../src/server/platform/jobs/retry.ts";
import { users } from "../../src/server/platform/db/schema.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startKernelFixture } from "./kernel-server.fixture.ts";
import type { KernelFixture } from "./kernel-server.fixture.ts";
import {
  ALLOWED_WEIGHT_PATHS,
  TRIMMED_WEIGHT_PATHS,
  allowedWeightBytes,
  startProxyWeightFixture,
  trimmedWeightBytes,
} from "./proxy-weight.fixture.ts";

interface Harness {
  browserUse: BrowserUseFixture;
  kernel: KernelFixture;
  buildUse: () => BrowserProvider;
  buildKernel: () => BrowserProvider;
  close: () => void;
}

function userRow(id: string, email: string) {
  const at = new Date();

  return {
    createdAt: at,
    email,
    emailVerified: true,
    id,
    name: id,
    role: "owner" as const,
    updatedAt: at,
  };
}

function startHarness(fixtureOptions: BrowserUseFixtureOptions = {}) {
  const browserUse = startBrowserUseFixture(fixtureOptions);
  const kernel = startKernelFixture();
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const at = new Date();

  db.insert(users)
    .values([
      { ...userRow("user-one", "one@example.test"), createdAt: at, updatedAt: at },
      { ...userRow("user-two", "two@example.test"), createdAt: at, updatedAt: at },
    ])
    .run();

  const clock = createClock();
  const profiles = createBrowserProfileStore(db, clock);

  const buildUse = () =>
    createBrowserUseBrowserProvider({
      client: BrowserUseClient("test-key", browserUse.url, clock),
      clock,
      profiles,
    });

  const buildKernel = () =>
    createKernelBrowserProvider({
      client: KernelClient("test-key", kernel.url),
      clock,
      profiles,
    });

  return {
    browserUse,
    buildKernel,
    buildUse,
    close: () => {
      browserUse.close();
      kernel.close();
      sqlite.close();
    },
    kernel,
  } satisfies Harness;
}

async function usesCdp(cdpUrl: string) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const page = browser.contexts()[0]?.pages()[0] ?? (await browser.newPage());

  await page.setContent("<p>provider test</p>");

  const text = await page.textContent("p");

  await browser.close();

  return text;
}

async function rejectionOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }

  throw new Error("the call was expected to fail");
}

async function expectProviderUnavailable(status: number, reason: string) {
  const harness = startHarness({ createStatus: status });

  try {
    const provider = harness.buildUse();
    const profileId = await provider.ensureProfile("user-one", "ca");

    const error = await rejectionOf(
      provider.open({
        attemptId: "attempt-unavailable",
        country: "ca",
        profileId,
        timeoutMinutes: 15,
      }),
    );

    expect(error).toBeInstanceOf(ProviderUnavailableError);

    if (!(error instanceof ProviderUnavailableError)) {
      throw new TypeError("the provider error was not surfaced");
    }

    expect(error.providerId).toBe("browser_use");
    expect(error.reason).toBe(reason);
  } finally {
    harness.close();
  }
}

test("a Browser Use session opens, is used, is stopped through the API and reports its cost", async () => {
  const harness = startHarness();

  try {
    const provider = harness.buildUse();
    const profileId = await provider.ensureProfile("user-one", "ca");

    const remote = await provider.open({
      attemptId: "attempt-use-1",
      country: "ca",
      profileId,
      timeoutMinutes: 15,
    });

    await expect(usesCdp(remote.cdpUrl)).resolves.toBe("provider test");

    const live = await provider.view(remote.sessionId);

    expect(live?.status).toBe("active");
    expect(live?.liveViewUrl).not.toBeNull();

    const usage = await remote.close();

    expect(usage.browserMs).toBe(556_000);
    expect(usage.proxyBytes).toBe(2_710_000);
    expect(usage.costMicros).toBe(28_800);
    expect(harness.browserUse.stoppedSessionIds).toContain(remote.sessionId);
    expect(harness.browserUse.stoppedAttemptIds).toContain("attempt-use-1");

    const stopped = await provider.view(remote.sessionId);

    expect(stopped?.status).toBe("stopped");
    expect(stopped?.liveViewUrl).toBeNull();
    expect(stopped?.recordingUrl).toContain(remote.sessionId);
    await expect(provider.listOpen()).resolves.toEqual([]);
  } finally {
    harness.close();
  }
});

test("a stop that fails still reports the usage of the ended session", async () => {
  const harness = startHarness({ failStops: true });

  try {
    const provider = harness.buildUse();
    const profileId = await provider.ensureProfile("user-one", "ca");

    const remote = await provider.open({
      attemptId: "attempt-stop-failed",
      country: "ca",
      profileId,
      timeoutMinutes: 15,
    });

    const usage = await remote.close();

    expect(usage.browserMs).toBe(556_000);
    expect(usage.proxyBytes).toBe(2_710_000);
    expect(usage.costMicros).toBe(28_800);
    expect(harness.browserUse.stoppedSessionIds).toEqual([]);
  } finally {
    harness.close();
  }
});

test("a stopped session still reports its usage to the recovery sweep", async () => {
  const harness = startHarness();

  try {
    const provider = harness.buildUse();
    const profileId = await provider.ensureProfile("user-one", "ca");

    const remote = await provider.open({
      attemptId: "attempt-sweep-usage",
      country: "ca",
      profileId,
      timeoutMinutes: 15,
    });

    await provider.stop(remote.sessionId);

    await expect(provider.sessionUsage(remote.sessionId)).resolves.toEqual({
      status: "stopped",
      usage: { browserMs: 556_000, costMicros: 28_800, proxyBytes: 2_710_000 },
    });

    await expect(provider.sessionUsage("session-that-never-existed")).resolves.toBeNull();
  } finally {
    harness.close();
  }
});

test("a 429 with a long Retry-After moves the retry to that delay instead of hammering", async () => {
  const harness = startHarness({ rateLimitFirstSessionCreates: 1, retryAfterSeconds: 300 });

  try {
    const provider = harness.buildUse();
    const profileId = await provider.ensureProfile("user-one", "ca");

    const error = await rejectionOf(
      provider.open({
        attemptId: "attempt-retry-after",
        country: "ca",
        profileId,
        timeoutMinutes: 15,
      }),
    );

    expect(error).toBeInstanceOf(RetryLaterError);

    if (!(error instanceof RetryLaterError)) {
      throw new TypeError("the 429 did not ask the job to wait");
    }

    expect(error.delayMs).toBe(300_000);
    expect(harness.browserUse.rateLimitResponses).toBe(1);
    expect(harness.browserUse.sessions).toEqual([]);
  } finally {
    harness.close();
  }
});

test("402 and 403 pause the provider instead of being retried", async () => {
  await expectProviderUnavailable(402, "no_credit");
  await expectProviderUnavailable(403, "forbidden");
});

test("a send session trims fonts, media and tracker hosts and keeps images, scripts and captchas", async () => {
  const harness = startHarness();
  const weight = startProxyWeightFixture();

  try {
    const provider = harness.buildUse();
    const profileId = await provider.ensureProfile("user-one", "ca");

    const remote = await provider.open({
      attemptId: "attempt-proxy-trim",
      country: "ca",
      profileId,
      timeoutMinutes: 15,
    });

    const browser = await chromium.connectOverCDP(remote.cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());

    await applySendProxyTrim(context);

    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(weight.url);

    await expect
      .poll(() => weight.requests().filter((hit) => hit.endsWith("/data.json")).length)
      .toBe(1);

    const reached = weight.requests();

    expect(reached.some((hit) => hit.endsWith("/"))).toBe(true);

    for (const path of ALLOWED_WEIGHT_PATHS.filter((entry) => entry !== "/")) {
      expect(reached.some((hit) => hit.endsWith(path))).toBe(true);
    }

    expect(reached.some((hit) => hit.includes("hcaptcha.com"))).toBe(true);
    expect(reached.some((hit) => hit.includes("www.doubleclick.net"))).toBe(false);
    expect(reached.some((hit) => hit.includes("clarity.ms"))).toBe(false);

    for (const path of TRIMMED_WEIGHT_PATHS) {
      expect(reached.some((hit) => hit.endsWith(path))).toBe(false);
    }

    expect(weight.bytesServed()).toBeGreaterThanOrEqual(allowedWeightBytes);
    expect(weight.bytesServed()).toBeLessThan(allowedWeightBytes + trimmedWeightBytes);

    await browser.close();
    await remote.close();

    weight.reset();

    const control = await provider.open({
      attemptId: "attempt-proxy-control",
      country: "ca",
      profileId,
      timeoutMinutes: 15,
    });

    const controlBrowser = await chromium.connectOverCDP(control.cdpUrl);
    const controlContext = await controlBrowser.newContext();
    const controlPage = await controlContext.newPage();

    await controlPage.goto(weight.url);

    await expect
      .poll(() => weight.requests().filter((hit) => hit.endsWith("/data.json")).length)
      .toBe(1);

    const untrimmed = weight.requests();

    expect(untrimmed.some((hit) => hit.endsWith("/"))).toBe(true);

    for (const path of [...ALLOWED_WEIGHT_PATHS, ...TRIMMED_WEIGHT_PATHS].filter(
      (entry) => entry !== "/",
    )) {
      expect(untrimmed.some((hit) => hit.endsWith(path))).toBe(true);
    }

    expect(untrimmed.some((hit) => hit.includes("www.doubleclick.net"))).toBe(true);
    expect(untrimmed.some((hit) => hit.includes("clarity.ms"))).toBe(true);

    await controlBrowser.close();
    await control.close();
  } finally {
    weight.close();
    harness.close();
  }
});

test("each user gets their own Browser Use profile, and deleting it goes through the API", async () => {
  const harness = startHarness();

  try {
    const provider = harness.buildUse();
    const first = await provider.ensureProfile("user-one", "ca");
    const again = await provider.ensureProfile("user-one", "ca");
    const second = await provider.ensureProfile("user-two", "ca");

    expect(again).toBe(first);
    expect(second).not.toBe(first);
    expect(harness.browserUse.profiles.map((profile) => profile.userId).toSorted()).toEqual([
      "user-one",
      "user-two",
    ]);

    await provider.deleteProfile(first);

    expect(harness.browserUse.deletedProfileIds).toContain(first);
  } finally {
    harness.close();
  }
});

test("the sweep lists an orphaned Browser Use session by attempt id and stops it", async () => {
  const harness = startHarness();

  try {
    const provider = harness.buildUse();
    const profileId = await provider.ensureProfile("user-one", "ca");

    const orphan = await provider.open({
      attemptId: "attempt-orphan",
      country: "ca",
      profileId,
      timeoutMinutes: 15,
    });

    await expect(provider.listOpen()).resolves.toEqual([
      { attemptId: "attempt-orphan", sessionId: orphan.sessionId },
    ]);

    await provider.stop(orphan.sessionId);

    expect(harness.browserUse.stoppedSessionIds).toContain(orphan.sessionId);
    await expect(provider.listOpen()).resolves.toEqual([]);
  } finally {
    harness.close();
  }
});

test("a Kernel session runs the same port, keeps its own profile and reports uptime and cost", async () => {
  const harness = startHarness();

  try {
    const provider = harness.buildKernel();
    const first = await provider.ensureProfile("user-one", "ca");
    const second = await provider.ensureProfile("user-two", "ca");

    expect(second).not.toBe(first);

    const remote = await provider.open({
      attemptId: "attempt-kernel-1",
      country: "ca",
      profileId: first,
      timeoutMinutes: 15,
    });

    await expect(usesCdp(remote.cdpUrl)).resolves.toBe("provider test");
    expect(remote.liveViewUrl).not.toBeNull();

    const usage = await remote.close();

    expect(usage.browserMs).toBe(556_000);
    expect(usage.costMicros).toBe(28_800);
    expect(usage.proxyBytes).toBe(0);
    expect(harness.kernel.deletedSessionIds).toContain(remote.sessionId);
    expect(harness.kernel.deletedAttemptIds).toContain("attempt-kernel-1");

    await expect(provider.sessionUsage(remote.sessionId)).resolves.toEqual({
      status: "stopped",
      usage: { browserMs: 556_000, costMicros: 28_800, proxyBytes: 0 },
    });

    const replay = await provider.view(remote.sessionId);

    expect(replay?.recordingUrl).toContain(remote.sessionId);
    await expect(provider.listOpen()).resolves.toEqual([]);
  } finally {
    harness.close();
  }
});
