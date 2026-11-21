import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import type { SseEvent } from "./sse.ts";

import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

const clockSchema = z.object({ now: z.number() });
const enqueueSchema = z.object({ id: z.string() });

const jobSchema = z.object({
  status: z.string(),
  attempts: z.number(),
  lastError: z.string().nullable(),
});

const jobDoneSchema = z.object({ id: z.string() });
const healthSchema = z.object({ status: z.string(), database: z.string() });

const JOB_POLL_INTERVAL_MS = "1000";
const HOUR_MS = 60 * 60_000;
const HEALTH_ROUTE = "/api/health";

function isDoneForJob(id: string) {
  return (event: SseEvent) => {
    if (event.event !== "job.done") {
      return false;
    }

    return jobDoneSchema.parse(JSON.parse(event.data)).id === id;
  };
}

test("a write lock held past busy_timeout is logged and retried, and the worker finishes the job", async ({
  isolatedAppServer: { url, databasePath, waitForStderr },
}) => {
  const settingsResponse = await fetch(`${url}/__test__/settings/jobs.poll_interval_ms`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: JOB_POLL_INTERVAL_MS }),
  });

  expect(settingsResponse.ok).toBe(true);

  const clockResponse = await fetch(`${url}/__test__/clock`);

  expect(clockResponse.ok).toBe(true);

  const { now } = clockSchema.parse(await clockResponse.json());

  const enqueueResponse = await fetch(`${url}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "test.ping", payload: "{}", runAt: now + HOUR_MS }),
  });

  expect(enqueueResponse.ok).toBe(true);

  const { id } = enqueueSchema.parse(await enqueueResponse.json());

  const busyLogged = waitForStderr(/jobs\.loop: .*database is locked/u);

  const lock = new DatabaseSync(databasePath);
  let holding = true;

  function release() {
    if (!holding) {
      return;
    }

    holding = false;

    try {
      lock.exec("COMMIT");
    } catch {}

    lock.close();
  }

  lock.exec("PRAGMA busy_timeout = 0");
  lock.exec("BEGIN IMMEDIATE");

  try {
    const offsetResponse = await fetch(`${url}/__test__/clock/offset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offsetMs: 2 * HOUR_MS }),
    });

    expect(offsetResponse.ok).toBe(true);

    expect(await busyLogged).toContain("database is locked");

    const healthResponse = await fetch(`${url}${HEALTH_ROUTE}`);

    expect(healthResponse.ok).toBe(true);

    const health = healthSchema.parse(await healthResponse.json());

    expect(health.status).toBe("ok");
    expect(health.database).toBe("ok");

    const done = readSseEventUntil(`${url}/api/events`, null, isDoneForJob(id));

    release();

    expect(await done).not.toBeNull();

    const jobResponse = await fetch(`${url}/__test__/jobs/${id}`);

    expect(jobResponse.ok).toBe(true);

    const job = jobSchema.parse(await jobResponse.json());

    expect(job.status).toBe("done");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toBeNull();
  } finally {
    release();

    await fetch(`${url}/__test__/clock/offset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offsetMs: 0 }),
    });

    await fetch(`${url}/__test__/settings/jobs.poll_interval_ms`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "15000" }),
    });
  }
});
