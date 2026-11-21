import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { startPersonioFixture } from "./personio.fixture.ts";

const createdSchema = z.object({ id: z.string() });

const probeSchema = z.object({
  ranAt: z.number().nullable(),
  summary: z
    .object({
      total: z.number(),
      readable: z.number(),
      needsReview: z.number(),
      unreadable: z.number(),
      unsupported: z.number(),
      passed: z.boolean(),
    })
    .nullable(),
  forms: z.array(
    z.object({
      index: z.number(),
      postingId: z.string(),
      url: z.string(),
      outcome: z.string(),
      questions: z.number(),
      required: z.number(),
      custom: z.number(),
      documents: z.number(),
      unhandled: z.string(),
    }),
  ),
});

async function seedPosting(appUrl: string, applyUrl: string, index: number) {
  const company = createdSchema.parse(
    await (
      await fetch(`${appUrl}/__test__/catalog/companies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `Personio Probe ${String(index)}` }),
      })
    ).json(),
  );

  const board = createdSchema.parse(
    await (
      await fetch(`${appUrl}/__test__/catalog/boards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          ats: "personio",
          boardToken: `probe-${String(index)}`,
        }),
      })
    ).json(),
  );

  return createdSchema.parse(
    await (
      await fetch(`${appUrl}/__test__/catalog/postings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ats: "personio",
          atsJobId: String(900_000 + index),
          boardId: board.id,
          companyId: company.id,
          title: `Personio Probe Role ${String(index)}`,
          url: applyUrl,
        }),
      })
    ).json(),
  );
}

test("an explicit list of real apply URLs is probed without enabling the ATS", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const fixture = startPersonioFixture({ variant: "standard" });

  try {
    const urls = [fixture.applyUrl("920001"), fixture.applyUrl("920002")];

    const queued = await fetch(`${adminIsolatedAppServer.url}/__test__/jobs/run-now`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "probe.personio", payload: JSON.stringify({ urls }) }),
    });

    expect(queued.ok).toBe(true);

    await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

    const response = await page.request.get(`${adminIsolatedAppUrl}/admin/api/probes/personio`);

    expect(response.status()).toBe(200);

    const probe = probeSchema.parse(await response.json());

    expect(probe.summary?.total).toBe(2);
    expect(probe.summary?.readable).toBe(2);
    expect(probe.summary?.passed).toBe(false);
    expect(probe.forms.map((form) => form.url).toSorted()).toEqual(urls.toSorted());
  } finally {
    fixture.close();
  }
});

test("the Personio probe routes are refused without the admin gates", async ({
  request,
  adminIsolatedAppUrl,
}) => {
  const read = await request.get(`${adminIsolatedAppUrl}/admin/api/probes/personio`);

  expect(read.status()).toBe(401);
  expect(await read.json()).toEqual({ error: "access_required" });

  const run = await request.post(`${adminIsolatedAppUrl}/admin/api/probes/personio`);

  expect(run.status()).toBe(401);
  expect(await run.json()).toEqual({ error: "access_required" });
});

test("the admin probes twenty Personio forms over plain HTTP and shows each result", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const fixture = startPersonioFixture({ variant: "standard" });

  try {
    await Promise.all(
      Array.from({ length: 20 }, async (_unused, index) =>
        seedPosting(adminIsolatedAppServer.url, fixture.applyUrl(String(910_000 + index)), index),
      ),
    );

    const queued = await fetch(`${adminIsolatedAppServer.url}/__test__/jobs/run-now`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "probe.personio", payload: "{}" }),
    });

    expect(queued.ok).toBe(true);

    await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

    const response = await page.request.get(`${adminIsolatedAppUrl}/admin/api/probes/personio`);

    expect(response.status()).toBe(200);

    const probe = probeSchema.parse(await response.json());

    expect(probe.ranAt).not.toBeNull();
    expect(probe.summary?.total).toBe(20);
    expect(probe.summary?.readable).toBe(20);
    expect(probe.summary?.unreadable).toBe(0);
    expect(probe.summary?.unsupported).toBe(0);
    expect(probe.summary?.passed).toBe(true);
    expect(probe.forms).toHaveLength(20);

    for (const form of probe.forms) {
      expect(form.outcome).toBe("readable");
      expect(form.questions).toBeGreaterThan(0);
      expect(form.documents).toBeGreaterThan(0);
      expect(form.unhandled).toBe("");
    }

    await page.goto(`${adminIsolatedAppUrl}/admin/catalog`);
    await expect(page.getByRole("heading", { name: "Personio probe" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run the probe" })).toBeVisible();
    await expect(page.getByText("The probe passes.")).toBeVisible();
  } finally {
    fixture.close();
  }
});
