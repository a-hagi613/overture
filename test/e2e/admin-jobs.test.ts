import { z } from "zod";

import { AxeBuilder } from "@axe-core/playwright";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import type { AppServer } from "./app-server.ts";

const jobRowSchema = z.object({
  attempts: z.number(),
  id: z.string(),
  kind: z.string(),
  lastError: z.string().nullable(),
  lockedUntil: z.number().nullable(),
  maxAttempts: z.number(),
  payloadPreview: z.string(),
  runAt: z.number(),
  status: z.string(),
});

const jobsSchema = z.object({
  counts: z.object({
    queued: z.number(),
    running: z.number(),
    done: z.number(),
    failed: z.number(),
    dead: z.number(),
    total: z.number(),
  }),
  kinds: z.array(z.string()),
  jobs: z.array(jobRowSchema),
  total: z.number(),
});

const jobActionSchema = z.object({ job: jobRowSchema });

const conflictSchema = z.object({ error: z.string(), status: z.string() });

const testJobSchema = z.object({
  attempts: z.number(),
  id: z.string(),
  kind: z.string(),
  lastError: z.string().nullable(),
  status: z.string(),
});

const auditSchema = z.object({
  audit: z.array(
    z.object({
      action: z.string(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    }),
  ),
});

const enqueueResponseSchema = z.object({ id: z.string() });

const DEAD_KIND = "test.jobs.dead";
const FAR_FUTURE = 9_999_999_999_999;

async function enqueue(
  server: AppServer,
  input: { kind: string; payload: string; runAt?: number; maxAttempts?: number },
) {
  const response = await fetch(`${server.url}/__test__/jobs/enqueue`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(response.ok).toBe(true);

  return enqueueResponseSchema.parse(await response.json()).id;
}

async function readTestJob(server: AppServer, id: string) {
  const response = await fetch(`${server.url}/__test__/jobs/${encodeURIComponent(id)}`);

  expect(response.ok).toBe(true);

  return testJobSchema.parse(await response.json());
}

async function runDue(server: AppServer) {
  const response = await fetch(`${server.url}/__test__/jobs/run-due`, { method: "POST" });

  expect(response.ok).toBe(true);
}

async function seedDeadJob(
  server: AppServer,
  kind = DEAD_KIND,
  payload = JSON.stringify({ token: "payload-secret-token", note: "a private note" }),
) {
  const id = await enqueue(server, { kind, maxAttempts: 1, payload });

  await runDue(server);

  await expect.poll(async () => (await readTestJob(server, id)).status).toBe("dead");

  return id;
}

test("the owner inspects, retries and cancels background jobs", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const server = adminIsolatedAppServer;
  const appUrl = adminIsolatedAppUrl;

  await openAdminAsOwner(page, appUrl, accessServer.issueToken);

  const queuedId = await enqueue(server, {
    kind: "test.jobs.queued",
    payload: JSON.stringify({ token: "payload-secret-token", applicationId: "app-queued" }),
    runAt: FAR_FUTURE,
  });

  const queuedList = jobsSchema.parse(
    await (
      await page.request.get(
        `${appUrl}/admin/api/jobs?kind=${encodeURIComponent("test.jobs.queued")}`,
      )
    ).json(),
  );

  const queued = queuedList.jobs.find((job) => job.id === queuedId);

  expect(queued?.status).toBe("queued");
  expect(queued?.attempts).toBe(0);
  expect(queued?.payloadPreview).toContain("token: hidden");
  expect(queued?.payloadPreview).toContain("applicationId: text(10)");
  expect(queued?.payloadPreview).not.toContain("payload-secret-token");
  expect(queuedList.counts.queued).toBeGreaterThanOrEqual(1);

  const cancelled = await page.request.post(
    `${appUrl}/admin/api/jobs/${encodeURIComponent(queuedId)}/cancel`,
  );

  expect(cancelled.status()).toBe(200);
  expect(jobActionSchema.parse(await cancelled.json()).job.status).toBe("failed");

  const deadId = await seedDeadJob(server);

  const deadList = jobsSchema.parse(
    await (await page.request.get(`${appUrl}/admin/api/jobs?status=dead`)).json(),
  );

  expect(deadList.jobs.some((job) => job.id === deadId)).toBe(true);
  expect(deadList.jobs.every((job) => job.status === "dead")).toBe(true);
  expect(deadList.total).toBeGreaterThanOrEqual(1);

  const retried = await page.request.post(
    `${appUrl}/admin/api/jobs/${encodeURIComponent(deadId)}/retry`,
  );

  expect(retried.status()).toBe(200);

  const retriedJob = jobActionSchema.parse(await retried.json()).job;

  expect(retriedJob.status).toBe("queued");
  expect(retriedJob.attempts).toBe(0);
  expect(retriedJob.lastError).toBeNull();

  const audit = auditSchema.parse(
    await (await page.request.get(`${appUrl}/admin/api/audit`)).json(),
  );

  const retryAudit = audit.audit.find((entry) => entry.action === "job.retry");
  const cancelAudit = audit.audit.find((entry) => entry.action === "job.cancel");

  expect(retryAudit?.detail.jobId).toBe(deadId);
  expect(retryAudit?.detail.previousStatus).toBe("dead");
  expect(cancelAudit?.detail.jobId).toBe(queuedId);
  expect(cancelAudit?.detail.previousStatus).toBe("queued");

  const retriedFailed = await page.request.post(
    `${appUrl}/admin/api/jobs/${encodeURIComponent(queuedId)}/retry`,
  );

  expect(retriedFailed.status()).toBe(200);
  expect(jobActionSchema.parse(await retriedFailed.json()).job.status).toBe("queued");

  const blockingId = await enqueue(server, {
    kind: "test.blocking",
    maxAttempts: 1,
    payload: "wait",
  });

  const running = fetch(`${server.url}/__test__/jobs/run-due`, { method: "POST" });

  await expect.poll(async () => (await readTestJob(server, blockingId)).status).toBe("running");

  const refusedRetry = await page.request.post(
    `${appUrl}/admin/api/jobs/${encodeURIComponent(blockingId)}/retry`,
  );

  expect(refusedRetry.status()).toBe(409);
  expect(conflictSchema.parse(await refusedRetry.json()).status).toBe("running");

  const refusedCancel = await page.request.post(
    `${appUrl}/admin/api/jobs/${encodeURIComponent(blockingId)}/cancel`,
  );

  expect(refusedCancel.status()).toBe(409);

  const missing = await page.request.post(
    `${appUrl}/admin/api/jobs/${encodeURIComponent("no-such-job")}/retry`,
  );

  expect(missing.status()).toBe(404);

  await fetch(`${server.url}/__test__/jobs/release`, { method: "POST" });
  await running;

  await expect.poll(async () => (await readTestJob(server, blockingId)).status).toBe("done");

  const completedList = jobsSchema.parse(
    await (
      await page.request.get(
        `${appUrl}/admin/api/jobs?status=completed&kind=${encodeURIComponent("test.blocking")}`,
      )
    ).json(),
  );

  expect(completedList.jobs.some((job) => job.id === blockingId)).toBe(true);
  expect(completedList.jobs.every((job) => job.status === "done")).toBe(true);
});

test("the Jobs page filters, confirms a retry and links from the Overview", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const server = adminIsolatedAppServer;
  const appUrl = adminIsolatedAppUrl;

  await openAdminAsOwner(page, appUrl, accessServer.issueToken);

  await seedDeadJob(server);
  const retryableId = await seedDeadJob(server, "test.retryable", "retry-once");

  await page.setViewportSize({ height: 900, width: 390 });
  await page.goto(`${appUrl}/admin/jobs?status=dead`);

  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dead/u, exact: false })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const retry = page.getByRole("button", { name: `Retry job ${retryableId}` });

  await retry.scrollIntoViewIfNeeded();
  await retry.click();
  await page.getByRole("button", { name: `Confirm the retry of job ${retryableId}` }).click();

  await expect(page.getByText("Retried the test.retryable job.")).toBeVisible();
  await expect(page.getByRole("button", { name: `Retry job ${retryableId}` })).toHaveCount(0, {
    timeout: 15_000,
  });

  await page.screenshot({ fullPage: true, path: "test-results/admin-jobs-390.png" });

  const mobileResults = await new AxeBuilder({ page }).analyze();

  expect(mobileResults.violations, "the jobs page at 390px").toEqual([]);

  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto(`${appUrl}/admin/jobs?status=dead`);

  await expect(page.getByRole("table")).toBeVisible();

  await page.screenshot({ fullPage: true, path: "test-results/admin-jobs-1280.png" });

  const desktopResults = await new AxeBuilder({ page }).analyze();

  expect(desktopResults.violations, "the jobs page at 1280px").toEqual([]);

  await seedDeadJob(server);
  await page.goto(`${appUrl}/admin`);

  const deadLink = page.getByRole("link", { name: /open the dead-letter queue/u });

  await expect(deadLink).toBeVisible();
  await deadLink.click();
  await expect(page).toHaveURL(/status=dead/u);
  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();

  await expect(page.getByRole("button", { name: /Dead/u, exact: false })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
