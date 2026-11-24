import { afterAll, describe, expect, test } from "bun:test";
import { z } from "zod";

import type { KernelBrowser } from "./kernel.ts";

import { createKernelBrowserProvider } from "./kernel-provider.ts";
import { KernelClient, kernelCreateBrowserBody } from "./kernel.ts";
import { createBrowserProfileStore } from "./profiles.ts";
import { browserModeForAttempt } from "./provider.ts";
import { openDatabase } from "../../platform/db/client.ts";
import { migrateDatabase } from "../../platform/db/migrate.ts";

const NOW = 2000;

const clock = { now: () => NOW };

const browserView = {
  cdp_ws_url: "wss://kernel.test/session-1",
  cost: { estimated_usage_spend_usd: "0.01", status: "pending" },
  created_at: "2026-11-22T09:00:00.000Z",
  session_id: "session-1",
  usage: { uptime_ms: 500 },
} satisfies KernelBrowser;

const createBodySchema = z.object({
  headless: z.boolean().optional(),
  stealth: z.boolean().optional(),
});

const { db, sqlite } = openDatabase(":memory:");

migrateDatabase(db, "drizzle");

const profiles = createBrowserProfileStore(db, clock);

afterAll(() => {
  sqlite.close();
});

function startKernelApi() {
  const sessions: { headless: boolean; stealth: boolean }[] = [];
  const reads: string[] = [];
  const deletes: string[] = [];
  const state = { failDeletes: false, failReads: false };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/browsers") {
        const body = createBodySchema.parse(await request.json());

        sessions.push({ headless: body.headless ?? false, stealth: body.stealth ?? false });

        return Response.json(browserView);
      }

      const match = /^\/browsers\/(?<id>[^/]+)$/u.exec(url.pathname);
      const sessionId = match?.groups?.["id"];

      if (sessionId === undefined) {
        return new Response("not found", { status: 404 });
      }

      if (request.method === "GET") {
        reads.push(sessionId);

        return state.failReads
          ? Response.json({ error: "read failed" }, { status: 500 })
          : Response.json(browserView);
      }

      if (request.method === "DELETE") {
        deletes.push(sessionId);

        return state.failDeletes
          ? Response.json({ error: "delete failed" }, { status: 500 })
          : new Response(null, { status: 204 });
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    close: () => {
      void server.stop(true);
    },
    deletes,
    reads,
    sessions,
    state,
    url: `http://127.0.0.1:${String(server.port)}`,
  };
}

function providerFor(api: ReturnType<typeof startKernelApi>) {
  return createKernelBrowserProvider({
    client: KernelClient("test-key", api.url),
    clock,
    profiles,
  });
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
    const api = startKernelApi();

    try {
      const provider = providerFor(api);

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

      expect(api.sessions).toEqual([
        { headless: true, stealth: false },
        { headless: false, stealth: true },
      ]);
    } finally {
      api.close();
    }
  });

  test("deletes the session in a finally block even when the usage read fails", async () => {
    const api = startKernelApi();

    try {
      const provider = providerFor(api);

      const remote = await provider.open({
        attemptId: "attempt-read-failed",
        country: "ca",
        profileId: null,
        timeoutMinutes: 15,
      });

      api.state.failReads = true;

      const usage = await remote.close();

      expect(usage).toEqual({ browserMs: 500, costMicros: 10_000, proxyBytes: null });
      expect(api.reads).toEqual(["session-1"]);
      expect(api.deletes).toEqual(["session-1"]);
    } finally {
      api.close();
    }
  });

  test("swallows a delete failure but still reports the session usage", async () => {
    const api = startKernelApi();

    try {
      const provider = providerFor(api);

      const remote = await provider.open({
        attemptId: "attempt-delete-failed",
        country: "ca",
        profileId: null,
        timeoutMinutes: 15,
      });

      api.state.failDeletes = true;

      const usage = await remote.close();

      expect(usage).toEqual({ browserMs: 500, costMicros: 10_000, proxyBytes: null });
      expect(api.deletes).toEqual(["session-1"]);
    } finally {
      api.close();
    }
  });
});
