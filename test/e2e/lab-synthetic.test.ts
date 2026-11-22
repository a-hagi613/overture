import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./lab.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const labReportRowSchema = z.object({
  ats: z.string().nullable(),
  captchaScore: z.number().nullable(),
  challengeRate: z.number().nullable(),
  codeRate: z.number().nullable(),
  completed: z.number(),
  completionRate: z.number().nullable(),
  costMicrosPerCompleted: z.number().nullable(),
  lastError: z.string().nullable(),
  p50DurationMs: z.number().nullable(),
  p95DurationMs: z.number().nullable(),
  page: z.string(),
  provider: z.string(),
  proxyMbPerCompleted: z.number().nullable(),
  sessions: z.number(),
});

const sendRowSchema = z.object({
  ats: z.string(),
  attempted: z.number(),
  attemptCount: z.number(),
  challengeRate: z.number().nullable(),
  codeRate: z.number().nullable(),
  completed: z.number(),
  completionRate: z.number().nullable(),
  costGateMet: z.boolean().nullable(),
  costGateMicros: z.number(),
  costMicrosPerCompleted: z.number().nullable(),
  p50BrowserMs: z.number().nullable(),
  p95BrowserMs: z.number().nullable(),
  provider: z.string(),
  proxyMbPerCompleted: z.number().nullable(),
  proxyTrend: z.boolean(),
  sentAttemptCount: z.number(),
});

const reportSchema = z.object({
  lab: z.array(labReportRowSchema),
  providers: z.array(sendRowSchema),
});

const jobSchema = z.object({ jobId: z.string() });

const scoreSchema = z.object({
  reason: z.string().nullable(),
  score: z.number().nullable(),
  success: z.boolean(),
});

async function reportOf(page: Parameters<typeof openAdminAsOwner>[0], labAppUrl: string) {
  return reportSchema.parse(
    await (await page.request.get(`${labAppUrl}/admin/api/provider-report`)).json(),
  );
}

async function runDueJobs(appUrl: string) {
  const run = await fetch(`${appUrl}/__test__/jobs/run-due`, { method: "POST" });

  expect(run.ok).toBe(true);
}

const seedAttempt = async (
  owner: Awaited<ReturnType<typeof ownerContextFor>>["owner"],
  applicationId: string,
  fields: {
    costMicros: number;
    n: number;
    outcome: string;
    provider: string;
    captchaSeen?: boolean;
    codeUsed?: boolean;
    browserMs?: number;
    proxyBytes?: number;
  },
) => {
  const seeded = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId,
      browserMs: fields.browserMs ?? 60_000,
      captchaSeen: fields.captchaSeen ?? false,
      codeUsed: fields.codeUsed ?? false,
      costMicros: fields.costMicros,
      n: fields.n,
      outcome: fields.outcome,
      provider: fields.provider,
      proxyBytes: fields.proxyBytes ?? 1_000_000,
      startedAt: 1_800_000_000_000 + fields.n * 1000,
    },
  });

  expect(seeded.ok()).toBe(true);
};

test("the lab pages serve challenge pages and recorded forms with no vendor host in the request", async ({
  labAppUrl,
  labVerify,
}) => {
  const index = await fetch(`${labAppUrl}/lab`);

  expect(index.status).toBe(200);
  expect(await index.text()).toContain("/lab/recaptcha-v3");

  const recaptcha = await (await fetch(`${labAppUrl}/lab/recaptcha-v3`)).text();

  expect(recaptcha).toContain("/__test__/lab-recaptcha.js");
  expect(recaptcha).not.toContain("google.com/recaptcha");
  expect(recaptcha).toContain('data-lab-status="waiting"');

  const hcaptcha = await (await fetch(`${labAppUrl}/lab/hcaptcha`)).text();
  const turnstile = await (await fetch(`${labAppUrl}/lab/turnstile`)).text();

  expect(hcaptcha).toContain("/__test__/lab-hcaptcha.js");
  expect(hcaptcha).not.toContain("hcaptcha.com");
  expect(turnstile).toContain("/__test__/lab-turnstile.js");
  expect(turnstile).not.toContain("challenges.cloudflare.com");

  const form = await (await fetch(`${labAppUrl}/lab/forms/greenhouse`)).text();

  expect(form).toContain('name="first_name"');
  expect(form).toContain('name="email"');
  expect(form).toContain('name="resume"');
  expect(form).not.toContain("http");

  const score = await fetch(`${labAppUrl}/lab/recaptcha/score`, {
    body: JSON.stringify({ token: "lab-recaptcha-token" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(scoreSchema.parse(await score.json())).toEqual({
    reason: null,
    score: labVerify.score,
    success: true,
  });
  expect(labVerify.calls).toBe(1);
});

test("the lab scores a reCAPTCHA v3 token on the server and never trusts the page", async ({
  labAppUrl,
  labVerify,
}) => {
  const response = await fetch(`${labAppUrl}/lab/recaptcha/score`, {
    body: JSON.stringify({ token: "lab-recaptcha-token" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(scoreSchema.parse(await response.json())).toEqual({
    reason: null,
    score: labVerify.score,
    success: true,
  });

  const refused = await fetch(`${labAppUrl}/lab/recaptcha/score`, {
    body: JSON.stringify({ token: "a-token-the-vendor-never-issued" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(scoreSchema.parse(await refused.json()).score).toBe(0.1);
});

test("the score endpoint refuses a burst of tokens from one client", async ({ labAppUrl }) => {
  const statuses = await Promise.all(
    Array.from(
      { length: 31 },
      async () =>
        (
          await fetch(`${labAppUrl}/lab/recaptcha/score`, {
            body: JSON.stringify({ token: "lab-recaptcha-token" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        ).status,
    ),
  );

  expect(statuses.filter((status) => status === 200)).toHaveLength(30);
  expect(statuses.filter((status) => status === 429)).toHaveLength(1);
});

test("a lab run records a session per browser and lab page, and the provider report shows them", async ({
  page,
  labAppServer,
  labAppUrl,
  accessServer,
}) => {
  test.setTimeout(240_000);

  await openAdminAsOwner(page, labAppUrl, accessServer.issueToken);

  const requested = await page.request.post(`${labAppUrl}/admin/api/lab/runs`, {
    data: {
      challenge: "pass",
      pages: [
        "recaptcha_v3",
        "hcaptcha",
        "turnstile",
        "form:greenhouse",
        "form:lever",
        "form:ashby",
      ],
      providers: ["browser_use", "kernel"],
      sessionsPerPage: 1,
    },
  });

  expect(requested.ok()).toBe(true);
  const first = jobSchema.parse(await requested.json());

  const repeated = await page.request.post(`${labAppUrl}/admin/api/lab/runs`, {
    data: {
      challenge: "pass",
      pages: ["recaptcha_v3"],
      providers: ["browser_use"],
      sessionsPerPage: 1,
    },
  });

  expect(repeated.ok()).toBe(true);
  expect(jobSchema.parse(await repeated.json()).jobId).toBe(first.jobId);

  await runDueJobs(labAppServer.url);

  await expect
    .poll(async () => (await reportOf(page, labAppUrl)).lab.length, { timeout: 180_000 })
    .toBe(12);

  const submitCheck = await fetch(`${labAppServer.url}/lab/forms/greenhouse/submit`, {
    body: "first_name=Maya",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  expect(submitCheck.status, await submitCheck.text()).toBe(200);

  const report = await reportOf(page, labAppUrl);

  for (const provider of ["browser_use", "kernel"]) {
    const recaptcha = report.lab.find(
      (row) => row.provider === provider && row.page === "recaptcha_v3",
    );

    expect(recaptcha?.sessions).toBe(1);
    expect(recaptcha?.completed).toBe(1);
    expect(recaptcha?.completionRate).toBe(1);
    expect(recaptcha?.challengeRate).toBe(1);
    expect(recaptcha?.captchaScore).toBeCloseTo(0.9, 5);
    expect(recaptcha?.p50DurationMs).not.toBeNull();

    for (const pageName of ["hcaptcha", "turnstile"]) {
      const row = report.lab.find(
        (candidate) => candidate.provider === provider && candidate.page === pageName,
      );

      expect(row?.completed, row?.lastError ?? "no error").toBe(1);
      expect(row?.completionRate).toBe(1);
      expect(row?.challengeRate).toBe(1);
    }

    for (const ats of ["greenhouse", "lever", "ashby"]) {
      const row = report.lab.find(
        (candidate) => candidate.provider === provider && candidate.page === `form:${ats}`,
      );

      expect(row?.ats).toBe(ats);
      expect(row?.completed, row?.lastError ?? "no error").toBe(1);
      expect(row?.challengeRate).toBe(0);
      expect(row?.codeRate).toBe(0);
    }
  }

  const browserUseForm = report.lab.find(
    (row) => row.provider === "browser_use" && row.page === "form:greenhouse",
  );

  expect(browserUseForm?.proxyMbPerCompleted).toBeCloseTo(2.71, 5);
  expect(browserUseForm?.costMicrosPerCompleted).toBe(28_800);

  await page.goto(`${labAppUrl}/admin/provider-report`);

  await expect(page.getByRole("heading", { name: "The provider report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The synthetic lab" })).toBeVisible();
  await expect(page.getByText("reCAPTCHA v3").first()).toBeVisible();
  await expect(page.getByText("Recorded Greenhouse form").first()).toBeVisible();
});

test("a lab run against a visible challenge records it as blocked", async ({
  page,
  labAppServer,
  labAppUrl,
  accessServer,
}) => {
  test.setTimeout(180_000);

  await openAdminAsOwner(page, labAppUrl, accessServer.issueToken);

  const requested = await page.request.post(`${labAppUrl}/admin/api/lab/runs`, {
    data: {
      challenge: "blocked",
      pages: ["turnstile"],
      providers: ["browser_use"],
      sessionsPerPage: 1,
    },
  });

  expect(requested.ok()).toBe(true);
  jobSchema.parse(await requested.json());

  await runDueJobs(labAppServer.url);

  await expect
    .poll(
      async () => {
        const row = (await reportOf(page, labAppUrl)).lab.find(
          (candidate) => candidate.provider === "browser_use" && candidate.page === "turnstile",
        );

        return row?.sessions ?? -1;
      },
      { timeout: 120_000 },
    )
    .toBe(1);

  const row = (await reportOf(page, labAppUrl)).lab.find(
    (candidate) => candidate.provider === "browser_use" && candidate.page === "turnstile",
  );

  expect(row?.completed).toBe(0);
  expect(row?.completionRate).toBe(0);
  expect(row?.challengeRate).toBe(1);
});

test("the provider report shows completion, code, challenge, duration, proxy and cost per browser and job board", async ({
  page,
  labAppServer,
  labAppUrl,
  accessServer,
}) => {
  const { owner, userId } = await ownerContextFor(labAppServer.url);

  const applications = new Map(
    await Promise.all(
      (["greenhouse", "lever"] as const).map(async (ats) => {
        const companyId = await seedCompany(owner, `Report ${ats}`, `${ats}.example`);

        const boardId = await seedBoard(owner, companyId, ats, `report-${ats}`);

        const applicationIds = await Promise.all(
          Array.from({ length: 4 }, async (_, index) => {
            const postingId = await seedPosting(owner, {
              ats,
              atsJobId: `${ats}-report-${String(index)}`,
              boardId,
              companyId,
              title: `Platform engineer ${String(index)}`,
              url: `https://example.test/${ats}/report/${String(index)}`,
            });

            return seedApplication(owner, { postingId, status: "sent", userId });
          }),
        );

        return [ats, applicationIds] as const;
      }),
    ),
  );

  const specs = [
    { browserMs: 60_000, captchaSeen: false, codeUsed: true, costMicros: 20_000, outcome: "sent" },
    { browserMs: 90_000, captchaSeen: false, codeUsed: false, costMicros: 20_000, outcome: "sent" },
    {
      browserMs: 120_000,
      captchaSeen: false,
      codeUsed: false,
      costMicros: 20_000,
      outcome: "sent",
    },
    {
      browserMs: 300_000,
      captchaSeen: true,
      codeUsed: false,
      costMicros: 10_000,
      outcome: "captcha_blocked",
    },
  ];

  const attempts = (["greenhouse", "lever"] as const).flatMap((ats) => {
    const applicationIds = applications.get(ats) ?? [];

    return (["browser_use", "kernel"] as const).flatMap((provider) =>
      specs.map(
        ({ browserMs, captchaSeen, codeUsed, costMicros, outcome }, index) =>
          ({
            applicationId: applicationIds[index] ?? "",
            browserMs,
            captchaSeen,
            codeUsed,
            costMicros,
            n: 1,
            outcome,
            provider,
            proxyBytes: 1_000_000,
          }) as const,
      ),
    );
  });

  await Promise.all(
    attempts.map(async (attempt) => await seedAttempt(owner, attempt.applicationId, attempt)),
  );

  await openAdminAsOwner(page, labAppUrl, accessServer.issueToken);

  const report = await reportOf(page, labAppUrl);

  for (const provider of ["browser_use", "kernel"]) {
    for (const ats of ["greenhouse", "lever"]) {
      const row = report.providers.find(
        (candidate) => candidate.provider === provider && candidate.ats === ats,
      );

      expect(row?.attempted).toBe(4);
      expect(row?.attemptCount).toBe(4);
      expect(row?.completed).toBe(3);
      expect(row?.sentAttemptCount).toBe(3);
      expect(row?.completionRate).toBeCloseTo(0.75, 5);
      expect(row?.codeRate).toBeCloseTo(0.25, 5);
      expect(row?.challengeRate).toBeCloseTo(0.25, 5);
      expect(row?.p50BrowserMs).toBe(90_000);
      expect(row?.p95BrowserMs).toBe(120_000);
      expect(row?.proxyMbPerCompleted).toBeCloseTo(4 / 3, 5);
      expect(row?.costMicrosPerCompleted).toBeCloseTo(70_000 / 3, 5);
      expect(row?.costGateMet).toBe(true);
      expect(row?.proxyTrend).toBe(false);
    }
  }
});
