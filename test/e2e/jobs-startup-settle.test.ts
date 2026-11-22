import { z } from "zod";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

import type { SseEvent } from "./sse.ts";

const clockSchema = z.object({ now: z.number() });
const enqueueSchema = z.object({ id: z.string() });
const jobDoneSchema = z.object({ id: z.string() });
const healthSchema = z.object({ status: z.string(), database: z.string() });

const HEALTH_BUDGET_MS = 1000;
const SETTLE_MS = 6000;
const EARLIEST_RUN_MS = SETTLE_MS / 2;

function isDoneForJob(id: string) {
  return (event: SseEvent) => {
    if (event.event !== "job.done") {
      return false;
    }

    return jobDoneSchema.parse(JSON.parse(event.data)).id === id;
  };
}

test("queued startup work waits for the settle window while /api/health keeps answering", async ({
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, {
    JOBS_STARTUP_SETTLE_MS: String(SETTLE_MS),
  });

  try {
    const clockResponse = await fetch(`${server.url}/__test__/clock`);

    expect(clockResponse.ok).toBe(true);

    const { now } = clockSchema.parse(await clockResponse.json());

    const enqueueResponse = await fetch(`${server.url}/__test__/jobs/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "test.ping", payload: "{}", runAt: now }),
    });

    expect(enqueueResponse.ok).toBe(true);

    const { id } = enqueueSchema.parse(await enqueueResponse.json());
    const enqueuedAt = performance.now();

    const healthStarted = performance.now();
    const healthResponse = await fetch(`${server.url}/api/health`);

    expect(healthResponse.ok).toBe(true);

    const health = healthSchema.parse(await healthResponse.json());

    expect(health.status).toBe("ok");
    expect(health.database).toBe("ok");
    expect(performance.now() - healthStarted).toBeLessThan(HEALTH_BUDGET_MS);

    expect(
      await readSseEventUntil(`${server.url}/api/events`, null, isDoneForJob(id)),
    ).not.toBeNull();
    expect(performance.now() - enqueuedAt).toBeGreaterThanOrEqual(EARLIEST_RUN_MS);
  } finally {
    await server.stop();
  }
});
