import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const clockResponseSchema = z.object({ now: z.number(), offsetMs: z.number() });
const enqueueResponseSchema = z.object({ id: z.string() });
const runDueResponseSchema = z.object({ ran: z.number() });
const jobStatusSchema = z.object({ status: z.string() });

async function waitForJobToRun(appUrl: string, id: string) {
  await expect
    .poll(
      async () => {
        const response = await fetch(`${appUrl}/__test__/jobs/${id}`);

        return jobStatusSchema.parse(await response.json()).status;
      },
      { timeout: 30_000 },
    )
    .toBe("done");
}

test("moving the clock and calling run-due fires jobs due at that time, with no sleeps", async ({
  appServerUrl,
}) => {
  const clockResponse = await fetch(`${appServerUrl}/__test__/clock`);

  expect(clockResponse.ok).toBe(true);

  const { now: nowMs } = clockResponseSchema.parse(await clockResponse.json());

  const futureMs = nowMs + 60 * 60_000;

  const enqueueResponse = await fetch(`${appServerUrl}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "test.ping",
      payload: "{}",
      runAt: futureMs,
    }),
  });

  expect(enqueueResponse.ok).toBe(true);

  const { id } = enqueueResponseSchema.parse(await enqueueResponse.json());

  const runBeforeMove = await fetch(`${appServerUrl}/__test__/jobs/run-due`, { method: "POST" });

  expect(runBeforeMove.ok).toBe(true);

  const { ran: ranBefore } = runDueResponseSchema.parse(await runBeforeMove.json());

  expect(ranBefore).toBe(0);

  const jobBeforeMoveResponse = await fetch(`${appServerUrl}/__test__/jobs/${id}`);
  const jobBeforeMove = jobStatusSchema.parse(await jobBeforeMoveResponse.json());

  expect(jobBeforeMove.status).toBe("queued");

  const moveClockResponse = await fetch(`${appServerUrl}/__test__/clock/offset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offsetMs: 2 * 60 * 60_000 }),
  });

  expect(moveClockResponse.ok).toBe(true);

  const runAfterMove = await fetch(`${appServerUrl}/__test__/jobs/run-due`, { method: "POST" });

  expect(runAfterMove.ok).toBe(true);

  runDueResponseSchema.parse(await runAfterMove.json());

  await waitForJobToRun(appServerUrl, id);

  await fetch(`${appServerUrl}/__test__/clock/offset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offsetMs: 0 }),
  });
});
