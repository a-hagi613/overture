import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { authTestIdentity } from "./auth.fixture.ts";
import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const overviewSchema = z.object({
  cost: z.object({
    completed: z.number(),
    costGateMet: z.boolean().nullable(),
    costMicrosPerCompleted: z.number().nullable(),
    proxyMbPerCompleted: z.number().nullable(),
    proxyTrend: z.boolean(),
  }),
  mail: z.object({
    total: z.number(),
    cap: z.number(),
    reserve: z.number(),
    noticeLimit: z.number(),
    refusedAt: z.number().nullable(),
  }),
});

const reportSchema = z.object({
  providers: z.array(
    z.object({
      ats: z.string(),
      costMicrosPerCompleted: z.number().nullable(),
      proxyMbPerCompleted: z.number().nullable(),
      proxyTrend: z.boolean(),
      sent: z.number(),
    }),
  ),
});

const captureSchema = z.object({ jobId: z.string() });

const DAY_MS = 86_400_000;

const jobSchema = z.object({ lastError: z.string().nullable(), status: z.string() });

function objectsRootOf(server: { databasePath: string }) {
  return join(dirname(server.databasePath), "objects");
}

async function formHtml(server: { databasePath: string }) {
  const root = objectsRootOf(server);
  const keys: string[] = [];

  for await (const key of new Bun.Glob("fixtures/greenhouse/*/form.html").scan({ cwd: root })) {
    keys.push(key);
  }

  const [key] = keys;

  if (key === undefined) {
    throw new Error("the capture job wrote no form");
  }

  return { html: readFileSync(join(root, key), "utf8"), key };
}

const syntheticPage = `<!doctype html>
<html><body>
<script>window.token = "employer-token";</script>
<p>Questions? Email maya.okafor@example.com</p>
<form method="post" action="/apply?utm_source=greenhouse">
  <input type="text" name="first_name" value="Maya" />
  <input type="email" name="email" value="maya.okafor@example.com" />
  <input type="hidden" name="authenticity_token" value="secret-csrf-token" />
  <textarea name="note">Maya will call you.</textarea>
  <button type="submit">Submit application</button>
</form>
</body></html>`;

test("the capture job never presses Submit and strips personal data", async ({
  page,
  captureAppServer,
  captureAppUrl,
  browserUseApi,
  accessServer,
}) => {
  let submissions = 0;

  const synthetic = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.method === "POST") {
        submissions += 1;

        return Response.json({ accepted: true });
      }

      return new Response(syntheticPage, { headers: { "content-type": "text/html" } });
    },
  });

  try {
    await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

    const requested = await page.request.post(`${captureAppUrl}/admin/api/fixtures/capture`, {
      data: { applyUrls: [`http://127.0.0.1:${String(synthetic.port)}/form`], ats: "greenhouse" },
    });

    expect(requested.ok()).toBe(true);
    captureSchema.parse(await requested.json());

    const run = await fetch(`${captureAppServer.url}/__test__/jobs/run-due`, { method: "POST" });

    expect(run.ok).toBe(true);

    await expect
      .poll(async () => {
        try {
          return (await formHtml(captureAppServer)).html;
        } catch {
          return "";
        }
      })
      .not.toBe("");

    const { html, key } = await formHtml(captureAppServer);

    expect(key).toMatch(/^fixtures\/greenhouse\//u);
    expect(html).not.toContain("maya.okafor@example.com");
    expect(html).not.toContain("Maya");
    expect(html).not.toContain("secret-csrf-token");
    expect(html).not.toContain("employer-token");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("utm_source");
    expect(html).toContain("applicant@example.invalid");
    expect(submissions).toBe(0);
    await expect.poll(() => new Set(browserUseApi.stoppedSessionIds).size).toBe(1);
  } finally {
    await synthetic.stop(true);
  }
});

const delayedFormPage = `<!doctype html>
<html><body>
<h1>Platform engineer</h1>
<p>The job description renders before the form.</p>
<div id="mount"></div>
<script>
setTimeout(() => {
  document.getElementById("mount").innerHTML =
    '<form method="post" action="/apply"><label>First name <input type="text" name="first_name" /></label>' +
    '<label>Email <input type="email" name="email" /></label>' +
    '<button type="submit">Submit application</button></form>';
}, 3000);
</script>
</body></html>`;

const pageWithoutForm = `<!doctype html>
<html><body>
<h1>Platform engineer</h1>
<p>The job description, and no application form.</p>
</body></html>`;

async function savedFixtureKeys(server: { databasePath: string }) {
  const keys: string[] = [];

  try {
    for await (const key of new Bun.Glob("fixtures/**/*").scan({ cwd: objectsRootOf(server) })) {
      keys.push(key);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  return keys.toSorted();
}

function servePage(html: string) {
  let submissions = 0;

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.method === "POST") {
        submissions += 1;

        return Response.json({ accepted: true });
      }

      return new Response(html, { headers: { "content-type": "text/html" } });
    },
  });

  return {
    server,
    submissions: () => submissions,
  };
}

test("the capture waits for a form that renders after load, and saves its inputs", async ({
  page,
  captureAppServer,
  captureAppUrl,
  browserUseApi,
  accessServer,
}) => {
  const served = servePage(delayedFormPage);

  try {
    await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

    const requested = await page.request.post(`${captureAppUrl}/admin/api/fixtures/capture`, {
      data: {
        applyUrls: [`http://127.0.0.1:${String(served.server.port)}/form`],
        ats: "greenhouse",
      },
    });

    expect(requested.ok()).toBe(true);
    captureSchema.parse(await requested.json());

    const run = await fetch(`${captureAppServer.url}/__test__/jobs/run-due`, { method: "POST" });

    expect(run.ok).toBe(true);

    await expect
      .poll(
        async () => {
          try {
            return (await formHtml(captureAppServer)).html;
          } catch {
            return "";
          }
        },
        { timeout: 60_000 },
      )
      .not.toBe("");

    const { html, key } = await formHtml(captureAppServer);

    expect(key).toMatch(/^fixtures\/greenhouse\//u);
    expect(html).toContain("Platform engineer");
    expect(html).toContain('name="first_name"');
    expect(html).toContain('name="email"');
    expect(html).not.toContain("<script");
    expect(served.submissions()).toBe(0);
    await expect.poll(() => new Set(browserUseApi.stoppedSessionIds).size).toBe(1);
  } finally {
    await served.server.stop(true);
  }
});

test("a page that never renders a form fails the capture with no_form_rendered and saves nothing", async ({
  page,
  captureAppServer,
  captureAppUrl,
  accessServer,
}) => {
  test.setTimeout(90_000);

  const served = servePage(pageWithoutForm);

  try {
    await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

    const requested = await page.request.post(`${captureAppUrl}/admin/api/fixtures/capture`, {
      data: {
        applyUrls: [`http://127.0.0.1:${String(served.server.port)}/form`],
        ats: "greenhouse",
      },
    });

    expect(requested.ok()).toBe(true);
    const { jobId } = captureSchema.parse(await requested.json());

    const run = await fetch(`${captureAppServer.url}/__test__/jobs/run-due`, { method: "POST" });

    expect(run.ok).toBe(true);

    await expect
      .poll(
        async () => {
          const job = jobSchema.parse(
            await (await fetch(`${captureAppServer.url}/__test__/jobs/${jobId}`)).json(),
          );

          return job.status === "dead" ? job.lastError : job.status;
        },
        { timeout: 60_000 },
      )
      .toContain("no_form_rendered");
    expect(await savedFixtureKeys(captureAppServer)).toEqual([]);
    expect(served.submissions()).toBe(0);
  } finally {
    await served.server.stop(true);
  }
});

test("the admin Overview and provider report show proxy MB and cost per completed Application against the gate", async ({
  page,
  captureAppServer,
  captureAppUrl,
  accessServer,
}) => {
  const { owner, userId } = await ownerContextFor(captureAppServer.url);

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");

  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const postingId = await seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    title: "Assistant General Manager | Durham",
    url: "https://example.test/blankstreet/jobs/8004209003",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  const base = 1_800_000_000_000;

  const seedAttempt = async (index: number, proxyBytes: number, browserMs: number) => {
    const seeded = await owner.post("/__test__/attempts/seed", {
      data: {
        applicationId,
        browserMs,
        costMicros: 20_000,
        n: 1,
        outcome: "sent",
        proxyBytes,
        provider: "browser_use",
        startedAt: base + index * 1000,
        userId,
      },
    });

    expect(seeded.ok()).toBe(true);
  };

  await Promise.all(
    Array.from({ length: 20 }, async (_, index) => {
      await seedAttempt(index, 1_000_000, 60_000);
    }),
  );
  await Promise.all(
    Array.from({ length: 20 }, async (_, offset) => {
      await seedAttempt(offset + 20, 3_000_000, 90_000);
    }),
  );

  await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

  await owner.post("/__test__/mail/usage", {
    data: { auth: 60, notice: 2070, system: 30 },
  });

  const overview = overviewSchema.parse(
    await (await page.request.get(`${captureAppUrl}/admin/api/overview`)).json(),
  );

  expect(overview.cost.completed).toBe(40);
  expect(overview.cost.proxyMbPerCompleted).toBeCloseTo(2, 5);
  expect(overview.cost.costMicrosPerCompleted).toBe(20_000);
  expect(overview.cost.costGateMet).toBe(true);
  expect(overview.cost.proxyTrend).toBe(true);
  expect(overview.mail).toMatchObject({
    cap: 2700,
    noticeLimit: 2430,
    reserve: 270,
    total: 2160,
  });

  const report = reportSchema.parse(
    await (await page.request.get(`${captureAppUrl}/admin/api/provider-report`)).json(),
  );

  const row = report.providers.find(
    (candidate) => candidate.ats === "greenhouse" && candidate.sent === 40,
  );

  expect(row?.costMicrosPerCompleted).toBe(20_000);
  expect(row?.proxyMbPerCompleted).toBeCloseTo(2, 5);
  expect(row?.proxyTrend).toBe(true);

  await page.goto(`${captureAppUrl}/admin`);
  await expect(page.getByRole("heading", { name: "Cost and proxy" })).toBeVisible();
  await expect(page.getByText("Proxy MB per completed Application")).toBeVisible();
  await expect(page.getByText("Proxy use per completed Application is trending up.")).toBeVisible();
  await expect(page.getByText("Email sending")).toBeVisible();
  await expect(page.getByText("Sent this month")).toBeVisible();
  await expect(page.getByText("2,160")).toBeVisible();
  await expect(page.getByText("Sends stop at 2,700; the last 270 are kept")).toBeVisible();
  await expect(page.getByText("Sending is stopped for this month.")).toHaveCount(0);
  await expect(page.getByText("Notices are paused for this month")).toHaveCount(0);

  await owner.post("/__test__/mail/usage", {
    data: { auth: 60, notice: 2430, reserveRefusedAt: 1_800_000_000_000, system: 30 },
  });
  await page.reload();

  await expect(
    page.getByText("Notices are paused for this month; sign-in mail and the live check still go."),
  ).toBeVisible();
  await expect(page.getByText("Sending is stopped for this month.")).toHaveCount(0);

  await owner.post("/__test__/mail/usage", {
    data: {
      auth: 60,
      notice: 2640,
      refusedAt: 1_800_000_100_000,
      reserveRefusedAt: 1_800_000_000_000,
      system: 30,
    },
  });
  await page.reload();

  await expect(page.getByText("Sending is stopped for this month.")).toBeVisible();
  await expect(page.getByText("Notices are paused for this month")).toHaveCount(0);
});

test("attempts older than the 30-day cost window are left out of the Overview and the provider report", async ({
  page,
  captureAppServer,
  captureAppUrl,
  accessServer,
}) => {
  const { owner, userId } = await ownerContextFor(captureAppServer.url);

  const companyId = await seedCompany(owner, "Window Street", "windowstreet.example");

  const boardId = await seedBoard(owner, companyId, "greenhouse", "windowstreet");

  const postingId = await seedPosting(owner, {
    atsJobId: "8004209005",
    boardId,
    companyId,
    title: "Assistant General Manager | Raleigh",
    url: "https://example.test/windowstreet/jobs/8004209005",
  });

  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  const { now } = z
    .object({ now: z.number() })
    .parse(await (await owner.get("/__test__/clock")).json());

  const seedAttempt = async (daysAgo: number, proxyBytes: number) => {
    const seeded = await owner.post("/__test__/attempts/seed", {
      data: {
        applicationId,
        browserMs: 60_000,
        costMicros: 20_000,
        n: 1,
        outcome: "sent",
        provider: "browser_use",
        proxyBytes,
        startedAt: now - daysAgo * DAY_MS,
        userId,
      },
    });

    expect(seeded.ok()).toBe(true);
  };

  await seedAttempt(31, 9_000_000);
  await seedAttempt(2, 1_000_000);
  await seedAttempt(3, 1_000_000);

  await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

  const overview = overviewSchema.parse(
    await (await page.request.get(`${captureAppUrl}/admin/api/overview`)).json(),
  );

  expect(overview.cost.completed).toBe(2);
  expect(overview.cost.proxyMbPerCompleted).toBe(1);
  expect(overview.cost.costMicrosPerCompleted).toBe(20_000);

  const report = reportSchema.parse(
    await (await page.request.get(`${captureAppUrl}/admin/api/provider-report`)).json(),
  );

  expect(report.providers).toHaveLength(1);
  expect(report.providers[0]).toMatchObject({
    ats: "greenhouse",
    costMicrosPerCompleted: 20_000,
    proxyMbPerCompleted: 1,
    sent: 2,
  });
});

test("an attempt's live view and replay open from the admin", async ({
  page,
  captureAppServer,
  captureAppUrl,
  browserUseApi,
  accessServer,
}) => {
  const { owner, userId } = await ownerContextFor(captureAppServer.url);

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");

  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const postingId = await seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    title: "Assistant General Manager | Durham",
    url: "https://example.test/blankstreet/jobs/8004209003",
  });

  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  const session = await fetch(`${browserUseApi.url}/api/v4/browsers`, {
    body: JSON.stringify({
      metadata: { attemptId: "attempt-live-view" },
      proxyCountryCode: "ca",
      solveCaptchas: true,
      timeout: 15,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then(async (response) => z.object({ id: z.string() }).parse(await response.json()));

  const seeded = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId,
      browserMs: 60_000,
      costMicros: 28_800,
      n: 1,
      outcome: "sent",
      provider: "browser_use",
      providerSessionId: session.id,
      proxyBytes: 2_710_000,
      userId,
    },
  });

  expect(seeded.ok()).toBe(true);

  const attemptId = z.object({ id: z.string() }).parse(await seeded.json()).id;

  await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

  const live = z
    .object({ liveViewUrl: z.string().nullable(), status: z.string() })
    .parse(
      await (
        await page.request.get(`${captureAppUrl}/admin/api/attempts/${attemptId}/live`)
      ).json(),
    );

  expect(live.status).toBe("active");
  expect(live.liveViewUrl).toContain(session.id);

  await fetch(`${browserUseApi.url}/api/v4/browsers/${session.id}`, {
    body: JSON.stringify({ action: "stop" }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });

  const replay = z
    .object({ recordingUrl: z.string() })
    .parse(
      await (
        await page.request.get(`${captureAppUrl}/admin/api/attempts/${attemptId}/replay`)
      ).json(),
    );

  expect(replay.recordingUrl).toContain(session.id);
});

test("Anthropic spend of the Application purposes raises the cost summary and the provider row, and the gate follows the total", async ({
  page,
  captureAppServer,
  captureAppUrl,
  accessServer,
}) => {
  const { owner, userId } = await ownerContextFor(captureAppServer.url);

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const postingId = await seedPosting(owner, {
    atsJobId: "8004209004",
    boardId,
    companyId,
    title: "Assistant General Manager | Durham",
    url: "https://example.test/blankstreet/jobs/8004209004",
  });

  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  const seeded = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId,
      browserMs: 60_000,
      costMicros: 20_000,
      n: 1,
      outcome: "sent",
      proxyBytes: 0,
      provider: "browser_use",
      startedAt: 1_800_000_000_000,
      userId,
    },
  });

  expect(seeded.ok()).toBe(true);

  const recordLlm = async (purpose: string, costMicros: number) => {
    const recorded = await owner.post("/__test__/llm/usage", {
      data: {
        email: authTestIdentity.ownerEmail,
        model: "claude-haiku-5-5",
        purpose,
        inputTokens: 1,
        cachedTokens: 0,
        outputTokens: 1,
        costMicros,
      },
    });

    expect(recorded.ok()).toBe(true);
  };

  await recordLlm("score", 15_000);
  await recordLlm("tag_fallback", 900_000);

  await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

  const overview = z
    .object({
      cost: z.object({
        anthropicMicros: z.number(),
        completed: z.number(),
        costGateMet: z.boolean().nullable(),
        costGateMicros: z.number(),
        costMicrosPerCompleted: z.number().nullable(),
      }),
    })
    .parse(await (await page.request.get(`${captureAppUrl}/admin/api/overview`)).json());

  expect(overview.cost).toMatchObject({
    anthropicMicros: 15_000,
    completed: 1,
    costGateMet: false,
    costGateMicros: 30_000,
    costMicrosPerCompleted: 35_000,
  });

  const report = z
    .object({
      providers: z.array(
        z.object({
          ats: z.string(),
          costGateMet: z.boolean().nullable(),
          costGateMicros: z.number(),
          costMicrosPerCompleted: z.number().nullable(),
          sent: z.number(),
        }),
      ),
    })
    .parse(await (await page.request.get(`${captureAppUrl}/admin/api/provider-report`)).json());

  expect(report.providers.find((row) => row.ats === "greenhouse" && row.sent === 1)).toMatchObject({
    costGateMet: false,
    costGateMicros: 30_000,
    costMicrosPerCompleted: 35_000,
  });
});
