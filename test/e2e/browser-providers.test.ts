import { chromium } from "playwright-core";
import { expect, test } from "@playwright/test";

import type { BrowserProvider } from "../../src/server/dispatch/browser/provider.ts";

import { BrowserUseClient } from "../../src/server/dispatch/browser/browser-use.ts";
import { createBrowserUseBrowserProvider } from "../../src/server/dispatch/browser/browser-use-provider.ts";
import { KernelClient } from "../../src/server/dispatch/browser/kernel.ts";
import { createKernelBrowserProvider } from "../../src/server/dispatch/browser/kernel-provider.ts";
import { createBrowserProfileStore } from "../../src/server/dispatch/browser/profiles.ts";
import { openDatabase } from "../../src/server/platform/db/client.ts";
import { migrateDatabase } from "../../src/server/platform/db/migrate.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";
import { users } from "../../src/server/platform/db/schema.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import type { BrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startKernelFixture } from "./kernel-server.fixture.ts";
import type { KernelFixture } from "./kernel-server.fixture.ts";

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

function startHarness() {
  const browserUse = startBrowserUseFixture();
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
      client: BrowserUseClient("test-key", browserUse.url),
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

    const replay = await provider.view(remote.sessionId);

    expect(replay?.recordingUrl).toContain(remote.sessionId);
    await expect(provider.listOpen()).resolves.toEqual([]);
  } finally {
    harness.close();
  }
});
