import { z } from "zod";

import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

const DAY_MS = 86_400_000;

type TestRouteBody = Record<string, string | number | Record<string, never>>;

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });
const enqueueSchema = z.object({ id: z.string() });
const jobSchema = z.object({ status: z.string() });

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

  const found = await readSseEventUntil(`${appServer.url}/api/events`, null, (event) => {
    topics.push(event.event);

    return event.event === marker;
  });

  expect(found).not.toBeNull();

  return topics;
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
