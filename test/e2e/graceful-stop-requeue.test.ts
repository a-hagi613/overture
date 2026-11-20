import { z } from "zod";

import type { SseEvent } from "./sse.ts";

import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

const enqueueResponseSchema = z.object({ id: z.string() });
const jobStatusSchema = z.object({ status: z.string(), attempts: z.number() });
const jobDoneSchema = z.object({ id: z.string() });
const okSchema = z.object({ ok: z.boolean() });

function isDoneForJob(id: string) {
  return (event: SseEvent) => {
    if (event.event !== "job.done") {
      return false;
    }

    return jobDoneSchema.parse(JSON.parse(event.data)).id === id;
  };
}

async function putPollIntervalMs(appServer: { url: string }, value: string) {
  await fetch(`${appServer.url}/__test__/settings/jobs.poll_interval_ms`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

test("SIGTERM requeues an in-flight job without consuming an attempt, and it completes after restart", async ({
  appServer,
}) => {
  await putPollIntervalMs(appServer, "1500");

  try {
    const enqueueResponse = await fetch(`${appServer.url}/__test__/jobs/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "test.blocking", payload: "{}" }),
    });

    expect(enqueueResponse.ok).toBe(true);

    const { id } = enqueueResponseSchema.parse(await enqueueResponse.json());

    const runningResponse = await fetch(`${appServer.url}/__test__/jobs/${id}`);

    expect(runningResponse.ok).toBe(true);

    const running = jobStatusSchema.parse(await runningResponse.json());

    expect(running.status).toBe("running");
    expect(running.attempts).toBe(1);

    await appServer.restart();

    const requeuedResponse = await fetch(`${appServer.url}/__test__/jobs/${id}`);

    expect(requeuedResponse.ok).toBe(true);

    const requeued = jobStatusSchema.parse(await requeuedResponse.json());

    expect(requeued.status).toBe("queued");
    expect(requeued.attempts).toBe(0);

    const releaseResponse = await fetch(`${appServer.url}/__test__/jobs/release`, {
      method: "POST",
    });

    expect(releaseResponse.ok).toBe(true);
    okSchema.parse(await releaseResponse.json());

    const done = await readSseEventUntil(`${appServer.url}/api/events`, null, isDoneForJob(id));

    expect(done).not.toBeNull();

    const completedResponse = await fetch(`${appServer.url}/__test__/jobs/${id}`);

    expect(completedResponse.ok).toBe(true);

    const completed = jobStatusSchema.parse(await completedResponse.json());

    expect(completed.status).toBe("done");
    expect(completed.attempts).toBe(1);
  } finally {
    await putPollIntervalMs(appServer, "15000");
  }
});
