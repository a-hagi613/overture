import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const enqueueResponseSchema = z.object({ id: z.string() });
const jobStatusSchema = z.object({ status: z.string(), attempts: z.number() });

test("a job enqueued before a restart completes after it, without consuming an attempt on the interrupted run", async ({
  appServer,
}) => {
  const enqueueResponse = await fetch(`${appServer.url}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "test.ping", payload: '{"msg":"hello"}' }),
  });

  expect(enqueueResponse.ok).toBe(true);

  const { id } = enqueueResponseSchema.parse(await enqueueResponse.json());

  await appServer.restart();

  const statusBeforeRun = await fetch(`${appServer.url}/__test__/jobs/${id}`);

  expect(statusBeforeRun.ok).toBe(true);

  const jobBeforeRun = jobStatusSchema.parse(await statusBeforeRun.json());

  expect(jobBeforeRun.status).toBe("queued");

  const runResponse = await fetch(`${appServer.url}/__test__/jobs/run-due`, { method: "POST" });

  expect(runResponse.ok).toBe(true);

  const statusResponse = await fetch(`${appServer.url}/__test__/jobs/${id}`);

  expect(statusResponse.ok).toBe(true);

  const job = jobStatusSchema.parse(await statusResponse.json());

  expect(job.status).toBe("done");
  expect(job.attempts).toBe(1);
});
