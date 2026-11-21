import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { AppServer } from "./app-server.ts";
import type { BrowserUseFixture, BrowserUseFixtureOptions } from "./browser-use-server.fixture.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";

const enqueuedSchema = z.object({ id: z.string() });

const jobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  lastError: z.string().nullable(),
  status: z.string(),
});

const jobsSchema = z.object({ jobs: z.array(jobSchema) });

const CAPTURE_KIND = "fixtures.capture";
const MAX_CONCURRENT_SESSIONS = 2;
const CAPTURE_COUNT = 24;

interface CaptureHarness {
  fixture: BrowserUseFixture;
  server: AppServer;
  pageUrl: (index: number) => string;
}

const captureFormPage = `<!doctype html>
<html><body>
<h1>Platform engineer</h1>
<form method="post" action="/apply">
  <label>First name <input type="text" name="first_name" /></label>
  <label>Email <input type="email" name="email" /></label>
  <button type="submit">Submit application</button>
</form>
</body></html>`;

async function startCaptureHarness(
  identityServer: IdentityServer,
  fixtureOptions: BrowserUseFixtureOptions,
  extraEnvironment: Record<string, string> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "overture-capture-cap-"));
  const fixture = startBrowserUseFixture(fixtureOptions);

  const pages = Bun.serve({
    port: 0,
    fetch() {
      return new Response(captureFormPage, { headers: { "content-type": "text/html" } });
    },
  });

  return startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "browser_use",
    BROWSER_PROXY_COUNTRY: "ca",
    BROWSER_USE_API_BASE_URL: fixture.url,
    BROWSER_USE_API_KEY: "capture-cap-test-key",
    OBJECT_STORE_ROOT: join(directory, "objects"),
    ...extraEnvironment,
  }).then(
    (server) =>
      ({
        fixture,
        pageUrl: (index: number) =>
          `http://127.0.0.1:${String(pages.port)}/form?capture=${String(index)}`,
        server,
        stop: async () => {
          await server.stop();
          fixture.close();
          await pages.stop(true);
        },
      }) satisfies CaptureHarness & { stop: () => Promise<void> },
  );
}

async function putSetting(server: AppServer, key: string, value: string) {
  const response = await fetch(`${server.url}/__test__/settings/${encodeURIComponent(key)}`, {
    body: JSON.stringify({ value }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });

  expect(response.ok).toBe(true);
}

async function enqueueCapture(server: AppServer, applyUrl: string, maxAttempts = 2) {
  const response = await fetch(`${server.url}/__test__/jobs/enqueue`, {
    body: JSON.stringify({
      kind: CAPTURE_KIND,
      maxAttempts,
      payload: JSON.stringify({ applyUrls: [applyUrl], ats: "greenhouse" }),
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(response.ok).toBe(true);

  return enqueuedSchema.parse(await response.json()).id;
}

async function runDueJobs(server: AppServer) {
  const response = await fetch(`${server.url}/__test__/jobs/run-due`, { method: "POST" });

  expect(response.ok).toBe(true);
}

async function captureJobs(server: AppServer) {
  const response = await fetch(`${server.url}/__test__/jobs`);

  expect(response.ok).toBe(true);

  return jobsSchema.parse(await response.json()).jobs.filter((job) => job.kind === CAPTURE_KIND);
}

test("24 queued captures all finish done and never open more sessions than the cap", async ({
  identityServer,
}) => {
  test.setTimeout(180_000);

  const harness = await startCaptureHarness(identityServer, {
    maxConcurrentSessions: MAX_CONCURRENT_SESSIONS,
  });

  try {
    await putSetting(harness.server, "jobs.batch_size", String(CAPTURE_COUNT));
    await putSetting(harness.server, "jobs.poll_interval_ms", "600000");
    await putSetting(
      harness.server,
      "browser.max_concurrent_sessions",
      String(MAX_CONCURRENT_SESSIONS),
    );

    await Promise.all(
      Array.from({ length: CAPTURE_COUNT }, async (_, index) =>
        enqueueCapture(harness.server, harness.pageUrl(index)),
      ),
    );

    await runDueJobs(harness.server);

    await expect
      .poll(
        async () => {
          const jobs = await captureJobs(harness.server);

          return [
            jobs.length,
            jobs.filter((job) => job.status === "done").length,
            jobs
              .filter((job) => job.status === "dead")
              .map((job) => job.lastError)
              .join(", "),
          ].join("|");
        },
        { timeout: 120_000 },
      )
      .toBe(`${String(CAPTURE_COUNT)}|${String(CAPTURE_COUNT)}|`);

    const jobs = await captureJobs(harness.server);

    expect(jobs.every((job) => job.status === "done")).toBe(true);
    expect(harness.fixture.peakActiveSessions).toBeLessThanOrEqual(MAX_CONCURRENT_SESSIONS);
    expect(harness.fixture.rateLimitResponses).toBe(0);
    expect(harness.fixture.sessions).toHaveLength(CAPTURE_COUNT);
    expect(new Set(harness.fixture.stoppedSessionIds).size).toBe(CAPTURE_COUNT);
  } finally {
    await harness.stop();
  }
});

async function waitForDone(server: AppServer) {
  await expect
    .poll(
      async () => {
        const [job] = await captureJobs(server);

        if (job === undefined) {
          return "missing";
        }

        return job.status === "dead" ? `${job.status}: ${job.lastError ?? ""}` : job.status;
      },
      { timeout: 60_000 },
    )
    .toBe("done");
}

test("a 429 on session create is retried without consuming the job's only attempt", async ({
  identityServer,
}) => {
  const harness = await startCaptureHarness(identityServer, {
    rateLimitFirstSessionCreates: 1,
  });

  try {
    await enqueueCapture(harness.server, harness.pageUrl(1), 1);

    await runDueJobs(harness.server);
    await waitForDone(harness.server);

    const jobs = await captureJobs(harness.server);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.lastError).toBeNull();
    expect(harness.fixture.rateLimitResponses).toBe(1);
    expect(harness.fixture.sessions).toHaveLength(1);
  } finally {
    await harness.stop();
  }
});

test("a capture whose first load times out retries the goto once and saves the form", async ({
  identityServer,
}) => {
  let loads = 0;

  const slowFirstLoad = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/form") {
        return new Response("not found", { status: 404 });
      }

      loads += 1;

      if (loads === 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, 5000);
        });
      }

      return new Response(captureFormPage, { headers: { "content-type": "text/html" } });
    },
  });

  const harness = await startCaptureHarness(
    identityServer,
    {},
    {
      BROWSER_NAVIGATION_TIMEOUT_MS: "500",
    },
  );

  try {
    await enqueueCapture(harness.server, `http://127.0.0.1:${String(slowFirstLoad.port)}/form`, 1);

    await runDueJobs(harness.server);
    await waitForDone(harness.server);

    expect(loads).toBe(2);
  } finally {
    await harness.stop();
    await slowFirstLoad.stop(true);
  }
});
