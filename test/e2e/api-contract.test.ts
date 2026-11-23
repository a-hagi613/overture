import { request as apiRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import { z } from "zod";

import type { AppServer } from "./app-server.ts";
import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { ownerContextFor } from "./matching-harness.ts";

const test = appTest.extend<{ contractServer: AppServer }>({
  contractServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const validationErrorSchema = z.object({
  error: z.literal("invalid_request"),
  issues: z.array(z.unknown()).min(1),
});

const errorSchema = z.object({ error: z.string() });

const notificationsSchema = z.object({
  notifications: z.array(z.object({ id: z.string(), title: z.string() })),
  unread: z.number(),
});

async function errorOf(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  return errorSchema.parse(await response.json()).error;
}

test("every signed-out route answers the one sign-in code", async ({ contractServer: { url } }) => {
  const anonymous = await apiRequest.newContext({ baseURL: url });

  const reads = [
    "/api/profile/targets",
    "/api/profile/facts",
    "/api/onboarding",
    "/api/board",
    "/api/ready",
    "/api/threads",
    "/api/reviews",
    "/api/calendar/feed",
    "/api/calendar/events",
    "/api/account/deletion",
    "/api/events",
    "/api/search?q=engineer",
  ];

  const writes: { method: "post" | "put"; path: string; data: unknown }[] = [
    { data: { facts: [] }, method: "put", path: "/api/profile/facts" },
    { data: { answer: "still_waiting" }, method: "post", path: "/api/checkins/checkin-1" },
    { data: { running: true }, method: "post", path: "/api/running" },
    { data: { state: "saved" }, method: "put", path: "/api/postings/posting-1/state" },
    {
      data: { category: "other", message: "Question", subject: "Help" },
      method: "post",
      path: "/api/support",
    },
  ];

  const readResults = await Promise.all(
    reads.map(async (path) => {
      const response = await anonymous.get(path);

      return { code: await errorOf(response), path, status: response.status() };
    }),
  );

  expect(readResults).toEqual(
    reads.map((path) => ({ code: "sign_in_required", path, status: 401 })),
  );

  const writeResults = await Promise.all(
    writes.map(async (write) => {
      const response = await anonymous.fetch(write.path, {
        data: write.data,
        method: write.method,
      });

      return { code: await errorOf(response), path: write.path, status: response.status() };
    }),
  );

  expect(writeResults).toEqual(
    writes.map((write) => ({ code: "sign_in_required", path: write.path, status: 401 })),
  );

  await anonymous.dispose();
});

test("a removed operational read answers not_found", async ({ contractServer: { url } }) => {
  const anonymous = await apiRequest.newContext({ baseURL: url });

  const removed = ["/api/settings", "/api/settings/limits.daily_cap", "/api/kill-switches"];

  const statuses = await Promise.all(
    removed.map(async (path) => ({ path, status: (await anonymous.get(path)).status() })),
  );

  expect(statuses).toEqual(removed.map((path) => ({ path, status: 404 })));

  await anonymous.dispose();
});

test("a missing row answers not_found from every resource route", async ({
  contractServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);

  const paths = [
    "/api/applications/application-does-not-exist",
    "/api/postings/posting-does-not-exist",
    "/api/threads/thread-does-not-exist",
    "/api/profile/resume/resume-does-not-exist/file",
    "/api/account/export/export-does-not-exist/download",
  ];

  const results = await Promise.all(
    paths.map(async (path) => {
      const response = await owner.get(path);

      return { code: await errorOf(response), path, status: response.status() };
    }),
  );

  expect(results).toEqual(paths.map((path) => ({ code: "not_found", path, status: 404 })));

  await owner.dispose();
});

test("a refused body is a 400 invalid_request with its issues", async ({
  contractServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);

  const wrongType = await owner.post("/api/notifications/read", { data: { id: 42 } });

  expect(wrongType.status()).toBe(400);

  const wrongTypeBody = validationErrorSchema.parse(await wrongType.json());

  expect(wrongTypeBody.issues.length).toBeGreaterThan(0);

  const missingFields = await owner.put("/api/profile/targets", { data: {} });

  expect(missingFields.status()).toBe(400);
  expect(validationErrorSchema.parse(await missingFields.json()).error).toBe("invalid_request");

  const malformed = await owner.fetch("/api/profile/targets", {
    data: "{not-json",
    headers: { "content-type": "application/json" },
    method: "PUT",
  });

  expect(malformed.status()).toBe(400);
  expect(await errorOf(malformed)).toBe("invalid_request");

  await owner.dispose();
});

test("an unhandled failure answers the shared 500 code, not a stack", async ({
  contractServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);

  const response = await owner.get("/__test__/unhandled-error");
  const body: unknown = await response.json();

  expect(response.status()).toBe(500);
  expect(body).toEqual({ error: "internal_error" });
  expect(JSON.stringify(body)).not.toContain("test-only unhandled failure");

  await owner.dispose();
});

test("the notification list keeps the newest hundred in reading order", async ({
  contractServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);
  const base = Date.UTC(2026, 10, 20, 12, 0, 0);

  const rows = Array.from({ length: 101 }, (_, index) => ({
    at: base + index * 60_000,
    body: `Body ${String(index)}`,
    kind: "review",
    title: `Row ${String(index)}`,
    url: "/review",
  }));

  const seeded = await owner.post("/__test__/notifications/seed", {
    data: { email: authTestIdentity.ownerEmail, rows },
  });

  expect(seeded.status()).toBe(200);

  const listed = notificationsSchema.parse(await (await owner.get("/api/notifications")).json());

  expect(listed.notifications).toHaveLength(100);
  expect(listed.notifications[0]?.title).toBe("Row 1");
  expect(listed.notifications.at(-1)?.title).toBe("Row 100");
  expect(listed.notifications.some((row) => row.title === "Row 0")).toBe(false);

  await owner.dispose();
});

const runningStateSchema = z.object({ pauseReason: z.string().nullable(), running: z.boolean() });

const blockedSchema = z.object({ error: z.literal("pause_blocked"), pauseReason: z.string() });

async function homeStateOf(owner: APIRequestContext) {
  return runningStateSchema.parse(await (await owner.get("/api/home")).json());
}

async function setPauseReason(owner: APIRequestContext, pauseReason: string) {
  const response = await owner.post("/__test__/home/pause", {
    data: { email: authTestIdentity.ownerEmail, pauseReason },
  });

  expect(response.ok()).toBe(true);
}

test("Resume starts only from no pause or the person's own pause", async ({
  contractServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);

  const started = await owner.post("/api/running", { data: { running: true } });

  expect(started.status()).toBe(200);
  expect(runningStateSchema.parse(await started.json())).toEqual({
    pauseReason: null,
    running: true,
  });

  const paused = await owner.post("/api/running", { data: { running: false } });

  expect(paused.status()).toBe(200);
  expect(await homeStateOf(owner)).toEqual({ pauseReason: "user", running: false });

  expect((await owner.post("/api/running", { data: { running: true } })).status()).toBe(200);

  const holds = [
    "onboarding",
    "no_resume",
    "plan_ended",
    "payment_failed",
    "suspended",
    "no_mailbox",
  ];

  async function refuseResumeAt(index: number) {
    const pauseReason = holds[index];

    if (pauseReason === undefined) {
      return;
    }

    await setPauseReason(owner, pauseReason);

    const refused = await owner.post("/api/running", { data: { running: true } });

    expect(refused.status()).toBe(409);
    expect(blockedSchema.parse(await refused.json())).toEqual({
      error: "pause_blocked",
      pauseReason,
    });
    expect(await homeStateOf(owner)).toEqual({ pauseReason, running: false });

    await refuseResumeAt(index + 1);
  }

  await refuseResumeAt(0);

  await owner.dispose();
});

test("Pause never replaces a billing or setup hold", async ({ contractServer: { url } }) => {
  const { owner } = await ownerContextFor(url);

  expect((await owner.post("/api/running", { data: { running: true } })).status()).toBe(200);

  const holds = ["payment_failed", "plan_ended", "onboarding"];

  async function refusePauseAt(index: number) {
    const pauseReason = holds[index];

    if (pauseReason === undefined) {
      return;
    }

    await setPauseReason(owner, pauseReason);

    const refused = await owner.post("/api/running", { data: { running: false } });

    expect(refused.status()).toBe(409);
    expect(blockedSchema.parse(await refused.json())).toEqual({
      error: "pause_blocked",
      pauseReason,
    });
    expect(await homeStateOf(owner)).toEqual({ pauseReason, running: false });

    await refusePauseAt(index + 1);
  }

  await refusePauseAt(0);

  await owner.dispose();
});

test("uploading a real resume clears its hold and a spoofed file is refused", async ({
  contractServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);

  const spoofed = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from("<!doctype html>not a pdf"),
        mimeType: "application/pdf",
        name: "fake.pdf",
      },
    },
  });

  expect(spoofed.status()).toBe(400);
  expect(await errorOf(spoofed)).toBe("invalid_request");

  expect((await owner.post("/api/running", { data: { running: true } })).status()).toBe(200);
  await setPauseReason(owner, "no_resume");

  const uploaded = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "resume.pdf",
      },
    },
  });

  expect(uploaded.status()).toBe(201);
  expect(await homeStateOf(owner)).toEqual({ pauseReason: null, running: true });

  await owner.dispose();
});
