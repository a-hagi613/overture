import { z } from "zod";

import type { SseEvent } from "./sse.ts";

import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

const clockResponseSchema = z.object({ now: z.number() });
const enqueueResponseSchema = z.object({ id: z.string() });
const jobStatusSchema = z.object({ status: z.string(), attempts: z.number() });
const jobDoneSchema = z.object({ id: z.string() });

function isDoneForJob(id: string) {
  return (event: SseEvent) => {
    if (event.event !== "job.done") {
      return false;
    }

    return jobDoneSchema.parse(JSON.parse(event.data)).id === id;
  };
}

test("a job enqueued before a restart completes after it, running in the real worker loop", async ({
  appServer,
}) => {
  const clockResponse = await fetch(`${appServer.url}/__test__/clock`);

  expect(clockResponse.ok).toBe(true);

  const { now } = clockResponseSchema.parse(await clockResponse.json());

  const pollResponse = await fetch(`${appServer.url}/__test__/settings/jobs.poll_interval_ms`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "1000" }),
  });

  expect(pollResponse.ok).toBe(true);

  const enqueueResponse = await fetch(`${appServer.url}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "test.ping",
      payload: '{"msg":"hello"}',
      runAt: now + 60 * 60_000,
    }),
  });

  expect(enqueueResponse.ok).toBe(true);

  const { id } = enqueueResponseSchema.parse(await enqueueResponse.json());

  await appServer.restart();

  const moveClockResponse = await fetch(`${appServer.url}/__test__/clock/offset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offsetMs: 2 * 60 * 60_000 }),
  });

  expect(moveClockResponse.ok).toBe(true);

  try {
    const done = await readSseEventUntil(`${appServer.url}/api/events`, null, isDoneForJob(id));

    expect(done).not.toBeNull();

    const statusResponse = await fetch(`${appServer.url}/__test__/jobs/${id}`);

    expect(statusResponse.ok).toBe(true);

    const job = jobStatusSchema.parse(await statusResponse.json());

    expect(job.status).toBe("done");
    expect(job.attempts).toBe(1);
  } finally {
    await fetch(`${appServer.url}/__test__/settings/jobs.poll_interval_ms`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "15000" }),
    });

    await fetch(`${appServer.url}/__test__/clock/offset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offsetMs: 0 }),
    });
  }
});
