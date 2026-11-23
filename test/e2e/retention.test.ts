import { z } from "zod";

import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

const DAY_MS = 86_400_000;

type TestRouteBody = Record<string, string | number | Record<string, never>>;

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });
const createdSchema = z.object({ id: z.string() });
const enqueueSchema = z.object({ id: z.string() });
const jobSchema = z.object({ status: z.string() });

const attemptsSchema = z.object({
  attempts: z.array(z.object({ id: z.string(), startedAt: z.number() })),
});

async function post(appServer: { url: string }, path: string, body: TestRouteBody) {
  const response = await fetch(`${appServer.url}/__test__${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  expect(response.ok).toBe(true);

  return response;
}

async function moveClockForward(appServer: { url: string }, ms: number) {
  const current = clockSchema.parse(await (await fetch(`${appServer.url}/__test__/clock`)).json());

  await post(appServer, "/clock/offset", { offsetMs: current.offsetMs + ms });
}

async function runDoneJob(appServer: { url: string }) {
  const { id } = enqueueSchema.parse(
    await (await post(appServer, "/jobs/enqueue", { kind: "test.ping", payload: "{}" })).json(),
  );

  await post(appServer, "/jobs/run-due", {});

  const job = jobSchema.parse(await (await fetch(`${appServer.url}/__test__/jobs/${id}`)).json());

  expect(job.status).toBe("done");

  return id;
}

async function jobExists(appServer: { url: string }, id: string) {
  const response = await fetch(`${appServer.url}/__test__/jobs/${id}`);

  return response.status !== 404;
}

async function topicsUntil(appServer: { url: string }, marker: string) {
  const topics: string[] = [];

  const found = await readSseEventUntil(`${appServer.url}/__test__/events`, null, (event) => {
    topics.push(event.event);

    return event.event === marker;
  });

  expect(found).not.toBeNull();

  return topics;
}

async function created(appServer: { url: string }, path: string, body: TestRouteBody) {
  const response = await post(appServer, path, body);

  return createdSchema.parse(await response.json()).id;
}

async function seedApplication(appServer: { url: string }) {
  const userId = await created(appServer, "/users", {
    email: "retention-attempts@example.invalid",
    name: "Retention Attempts",
  });

  const companyId = await created(appServer, "/catalog/companies", {
    domain: "retention-attempts.example",
    name: "Retention Attempts Co",
  });

  const boardId = await created(appServer, "/catalog/boards", {
    ats: "greenhouse",
    boardToken: "retention-attempts",
    companyId,
  });

  const postingId = await created(appServer, "/catalog/postings", {
    ats: "greenhouse",
    atsJobId: "retention-attempts-1",
    boardId,
    companyId,
    title: "Platform Engineer",
    url: "https://example.test/retention-attempts/jobs/1",
  });

  return created(appServer, "/applications/seed", { postingId, status: "ready", userId });
}

async function seedAttempt(appServer: { url: string }, applicationId: string, startedAt: number) {
  await post(appServer, "/attempts/seed", {
    applicationId,
    outcome: "sent",
    provider: "browser_use",
    startedAt,
  });
}

async function attemptStartTimes(appServer: { url: string }, applicationId: string) {
  const response = await fetch(
    `${appServer.url}/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`,
  );

  expect(response.ok).toBe(true);

  return attemptsSchema.parse(await response.json()).attempts.map((attempt) => attempt.startedAt);
}

test("the retention job drops old events and finished jobs, and keeps recent ones", async ({
  appServer,
}) => {
  await post(appServer, "/events/publish", { topic: "retention.old", payload: {} });

  const oldJobId = await runDoneJob(appServer);

  await moveClockForward(appServer, 8 * DAY_MS);

  await post(appServer, "/events/publish", { topic: "retention.recent", payload: {} });

  const recentJobId = await runDoneJob(appServer);

  await post(appServer, "/jobs/run-now", { kind: "maintenance.retention", payload: "{}" });

  await post(appServer, "/events/publish", { topic: "retention.marker", payload: {} });

  const topics = await topicsUntil(appServer, "retention.marker");

  expect(topics).not.toContain("retention.old");
  expect(topics).toContain("retention.recent");
  expect(await jobExists(appServer, oldJobId)).toBe(false);
  expect(await jobExists(appServer, recentJobId)).toBe(true);
});

test("the retention job prunes attempts older than 180 days and keeps newer ones", async ({
  appServer,
}) => {
  const applicationId = await seedApplication(appServer);

  const { now } = clockSchema.parse(await (await fetch(`${appServer.url}/__test__/clock`)).json());

  const old = now - 181 * DAY_MS;
  const recent = now - 179 * DAY_MS;

  await seedAttempt(appServer, applicationId, old);
  await seedAttempt(appServer, applicationId, recent);

  await post(appServer, "/jobs/run-now", { kind: "maintenance.retention", payload: "{}" });

  expect(await attemptStartTimes(appServer, applicationId)).toEqual([recent]);
});
