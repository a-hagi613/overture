import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const enqueueResponseSchema = z.object({ id: z.string() });
const runDueResponseSchema = z.object({ ran: z.number() });
const jobStatusSchema = z.object({ status: z.string() });

test("a job enqueued before a restart completes after it", async ({ appServer }) => {
  const enqueueResponse = await fetch(`${appServer.url}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "test.ping", payload: '{"msg":"hello"}' }),
  });

  expect(enqueueResponse.ok).toBe(true);

  const { id } = enqueueResponseSchema.parse(await enqueueResponse.json());

  await appServer.restart();

  const runResponse = await fetch(`${appServer.url}/__test__/jobs/run-due`, { method: "POST" });

  expect(runResponse.ok).toBe(true);

  const { ran } = runDueResponseSchema.parse(await runResponse.json());

  expect(ran).toBe(1);

  const statusResponse = await fetch(`${appServer.url}/__test__/jobs/${id}`);

  expect(statusResponse.ok).toBe(true);

  const job = jobStatusSchema.parse(await statusResponse.json());

  expect(job.status).toBe("done");
});
