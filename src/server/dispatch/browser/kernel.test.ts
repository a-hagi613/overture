import { describe, expect, test } from "bun:test";

import type { BrowserProfileStore } from "./profiles.ts";
import type { CreateKernelBrowserInput, KernelBrowser, KernelClient } from "./kernel.ts";

import { createKernelBrowserProvider } from "./kernel-provider.ts";
import { kernelCreateBrowserBody } from "./kernel.ts";
import { browserModeForAttempt } from "./provider.ts";

const NOW = 2000;

const clock = { now: () => NOW };

const browserView: KernelBrowser = {
  cdp_ws_url: "wss://kernel.test/session-1",
  created_at: "2026-11-22T09:00:00.000Z",
  session_id: "session-1",
  usage: { uptime_ms: 500 },
  cost: { estimated_usage_spend_usd: "0.01", status: "pending" },
};

const profiles = {
  find: () => undefined,
  forget: () => undefined,
  remember: (input: { providerProfileId: string }) => input.providerProfileId,
  touch: () => undefined,
} satisfies BrowserProfileStore;

function fakeClient(options: { deleteFails?: boolean; readFails?: boolean } = {}) {
  const deleted: string[] = [];
  const modes: (string | undefined)[] = [];

  const client = {
    createBrowser: async (input: CreateKernelBrowserInput) => {
      modes.push(input.mode);

      return await Promise.resolve(browserView);
    },
    createProfile: async (name: string) =>
      await Promise.resolve({ created_at: browserView.created_at, id: name }),
    deleteBrowser: async (sessionId: string) => {
      deleted.push(sessionId);

      if (options.deleteFails === true) {
        throw new Error("the session was already gone");
      }

      await Promise.resolve();
    },
    deleteProfile: async () => {
      await Promise.resolve();
    },
    getBrowser: async () => {
      if (options.readFails === true) {
        throw new Error("the usage read failed");
      }

      return await Promise.resolve(browserView);
    },
    listBrowsers: async () => await Promise.resolve([browserView]),
    listReplays: async () => await Promise.resolve([]),
  } satisfies ReturnType<typeof KernelClient>;

  return { client, deleted, modes };
}

describe("the Kernel session body", () => {
  test("defaults to a headless session instead of Kernel's headful default", () => {
    const body = kernelCreateBrowserBody({
      attemptId: "attempt-1",
      profileId: null,
      timeoutSeconds: 900,
    });

    expect(body.headless).toBe(true);
    expect(body.stealth).toBe(false);
    expect(body.captcha_solver).toEqual({ enabled: true });
    expect(body.tags).toEqual({ attemptId: "attempt-1", purpose: "application" });
  });

  test("asks for headful stealth only after a bot block escalates", () => {
    const body = kernelCreateBrowserBody({
      attemptId: "attempt-2",
      mode: "stealth",
      profileId: "profile-1",
      timeoutSeconds: 900,
    });

    expect(body.headless).toBe(false);
    expect(body.stealth).toBe(true);
    expect(body.profile).toEqual({ id: "profile-1", save_changes: true });
  });
});

describe("the Kernel mode escalation", () => {
  test("a headless bot block or CAPTCHA escalates the next Kernel attempt to stealth", () => {
    expect(browserModeForAttempt("kernel", "captcha_blocked")).toBe("stealth");
    expect(browserModeForAttempt("kernel", "blocked")).toBe("stealth");
  });

  test("every other outcome, and every other provider, stays headless", () => {
    expect(browserModeForAttempt("kernel", "timeout")).toBe("headless");
    expect(browserModeForAttempt("kernel", "provider_error")).toBe("headless");
    expect(browserModeForAttempt("kernel", null)).toBe("headless");
    expect(browserModeForAttempt("browser_use", "captcha_blocked")).toBe("headless");
  });
});

describe("the Kernel provider", () => {
  test("passes the requested mode to the control API and defaults to headless", async () => {
    const fake = fakeClient();

    const provider = createKernelBrowserProvider({
      client: fake.client,
      clock,
      profiles,
    });

    await provider.open({
      attemptId: "attempt-default",
      country: "ca",
      profileId: null,
      timeoutMinutes: 15,
    });
    await provider.open({
      attemptId: "attempt-escalated",
      country: "ca",
      mode: "stealth",
      profileId: null,
      timeoutMinutes: 15,
    });

    expect(fake.modes).toEqual(["headless", "stealth"]);
  });

  test("deletes the session in a finally block even when the usage read fails", async () => {
    const fake = fakeClient({ readFails: true });

    const provider = createKernelBrowserProvider({
      client: fake.client,
      clock,
      profiles,
    });

    const remote = await provider.open({
      attemptId: "attempt-read-failed",
      country: "ca",
      profileId: null,
      timeoutMinutes: 15,
    });

    const usage = await remote.close();

    expect(usage).toEqual({
      browserMs: 500,
      costMicros: 10_000,
      proxyBytes: null,
    });
    expect(fake.deleted).toEqual(["session-1"]);
  });

  test("swallows a delete failure but still reports the session usage", async () => {
    const fake = fakeClient({ deleteFails: true });

    const provider = createKernelBrowserProvider({
      client: fake.client,
      clock,
      profiles,
    });

    const remote = await provider.open({
      attemptId: "attempt-delete-failed",
      country: "ca",
      profileId: null,
      timeoutMinutes: 15,
    });

    const usage = await remote.close();

    expect(usage).toEqual({
      browserMs: 500,
      costMicros: 10_000,
      proxyBytes: null,
    });
    expect(fake.deleted).toEqual(["session-1"]);
  });
});
