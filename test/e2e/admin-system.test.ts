import { statSync } from "node:fs";

import { Database } from "bun:sqlite";
import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { catalogDatabasePathFor } from "./template-databases.ts";

const rejectionSchema = z.object({ error: z.string() });

const databaseSizesSchema = z.object({
  fileBytes: z.number(),
  freeBytes: z.number(),
  freelistCount: z.number(),
  pageCount: z.number(),
  pageSize: z.number(),
  walBytes: z.number(),
});

const liveCheckSchema = z.object({
  check: z.string(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  durationMs: z.number(),
  id: z.string(),
  ok: z.boolean(),
  runId: z.string(),
  startedAt: z.number(),
});

const systemSchema = z.object({
  backups: z.discriminatedUnion("replication", [
    z.object({ replication: z.literal("unconfigured") }),
    z.object({ readAgeSeconds: z.number().nullable(), replication: z.literal("unknown") }),
    z.object({ readAgeSeconds: z.number(), replication: z.literal("unavailable") }),
    z.object({
      lagSeconds: z.number(),
      readAgeSeconds: z.number(),
      replicaTxid: z.string(),
      replication: z.literal("ok"),
    }),
  ]),
  catalog: z.object({
    boards: z.number(),
    closedPostings: z.number(),
    lastPolledAt: z.number().nullable(),
    lastSeenAt: z.number().nullable(),
    openPostings: z.number(),
  }),
  databases: z.object({
    app: databaseSizesSchema.nullable(),
    catalog: databaseSizesSchema.nullable(),
  }),
  degraded: z.unknown().nullable(),
  generatedAt: z.number(),
  integrations: z.object({
    browserProvider: z.string().nullable(),
    cfAccessConfigured: z.boolean(),
    cloudflareEmailConfigured: z.boolean(),
    demoLoginEnabled: z.boolean(),
    ntfyConfigured: z.boolean(),
    publicSignupEnabled: z.boolean(),
    stripeMode: z.enum(["live", "test", "unconfigured"]),
    turnstileConfigured: z.boolean(),
  }),
  liveChecks: z.object({
    latestRunAt: z.number().nullable(),
    results: z.array(liveCheckSchema),
  }),
  runtime: z.object({
    bunVersion: z.string(),
    heapTotalBytes: z.number(),
    heapUsedBytes: z.number(),
    loadAverage: z.tuple([z.number(), z.number(), z.number()]),
    rssBytes: z.number(),
    uptimeSeconds: z.number(),
  }),
  volume: z
    .object({
      freeBytes: z.number(),
      mount: z.string(),
      totalBytes: z.number(),
      usedRatio: z.number(),
    })
    .nullable(),
});

const checkpointSchema = z.object({
  afterWalBytes: z.number(),
  beforeWalBytes: z.number(),
  busy: z.number(),
  checkpointed: z.number(),
});

const jobSchema = z.object({ jobId: z.string() });

const auditSchema = z.object({
  audit: z.array(
    z.object({
      action: z.string(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      id: z.string(),
      reason: z.string(),
    }),
  ),
});

function sizesOracle(path: string) {
  const database = new Database(path, { readonly: true });

  database.run("PRAGMA busy_timeout = 5000;");

  try {
    return {
      freelistCount: z
        .object({ freelist_count: z.number() })
        .parse(database.query("PRAGMA freelist_count;").get()).freelist_count,
      pageCount: z
        .object({ page_count: z.number() })
        .parse(database.query("PRAGMA page_count;").get()).page_count,
      pageSize: z.object({ page_size: z.number() }).parse(database.query("PRAGMA page_size;").get())
        .page_size,
    };
  } finally {
    database.close();
  }
}

function boardCountOracle(path: string) {
  const database = new Database(path, { readonly: true });

  database.run("PRAGMA busy_timeout = 5000;");

  try {
    return z
      .object({ total: z.number() })
      .parse(database.query("select count(*) as total from company_boards").get()).total;
  } finally {
    database.close();
  }
}

function expectNoSecrets(raw: string) {
  expect(raw.includes(authTestIdentity.ownerEmail)).toBe(false);
  expect(raw.includes("sk_live_")).toBe(false);
  expect(raw.includes("sk_test_")).toBe(false);
  expect(raw.includes("SECRET")).toBe(false);
}

test("the system API reports databases, backups, catalog and live checks without secrets", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(180_000);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const unauthenticated = await fetch(`${adminIsolatedAppUrl}/admin/api/system`);

  expect(unauthenticated.status).toBe(401);
  expect(rejectionSchema.parse(await unauthenticated.json()).error).toBe("access_required");

  const before = await page.request.get(`${adminIsolatedAppUrl}/admin/api/system`);

  expect(before.status()).toBe(200);

  const rawBefore = await before.text();

  expectNoSecrets(rawBefore);

  const report = systemSchema.parse(JSON.parse(rawBefore));

  expect(report.databases.app).not.toBeNull();
  expect(report.databases.app?.fileBytes).toBe(statSync(adminIsolatedAppServer.databasePath).size);

  const appOracle = sizesOracle(adminIsolatedAppServer.databasePath);

  expect(report.databases.app?.freelistCount).toBe(appOracle.freelistCount);
  expect(report.databases.app?.pageCount).toBe(appOracle.pageCount);
  expect(report.databases.app?.pageSize).toBe(appOracle.pageSize);
  expect(report.databases.app?.freeBytes).toBe(appOracle.freelistCount * appOracle.pageSize);

  const catalogPath = catalogDatabasePathFor(adminIsolatedAppServer.databasePath);

  expect(report.databases.catalog).not.toBeNull();
  expect(report.databases.catalog?.fileBytes).toBe(statSync(catalogPath).size);
  expect(report.catalog.boards).toBe(boardCountOracle(catalogPath));

  expect(report.volume).not.toBeNull();
  expect(report.volume?.totalBytes).toBeGreaterThan(0);
  expect(report.volume?.usedRatio).toBeGreaterThanOrEqual(0);
  expect(report.volume?.usedRatio).toBeLessThanOrEqual(1);
  expect(report.backups.replication).toBe("unconfigured");
  expect(report.degraded).toBeNull();
  expect(report.runtime.rssBytes).toBeGreaterThan(0);
  expect(report.runtime.bunVersion.length).toBeGreaterThan(0);
  expect(report.integrations.stripeMode).toBe("unconfigured");

  const seeded = await page.request.post(`${adminIsolatedAppServer.url}/__test__/jobs/run-now`, {
    data: { kind: "live.check", payload: JSON.stringify({ groups: ["alerts"] }) },
  });

  expect(seeded.ok()).toBe(true);

  const withChecks = systemSchema.parse(
    JSON.parse(await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/system`)).text()),
  );

  expect(withChecks.liveChecks.results.length).toBeGreaterThan(0);
  expect(withChecks.liveChecks.latestRunAt).not.toBeNull();
  expect(withChecks.liveChecks.results.some((result) => result.check === "alert.health")).toBe(
    true,
  );

  const checkpoint = await page.request.post(`${adminIsolatedAppUrl}/admin/api/system/checkpoint`);

  expect(checkpoint.status()).toBe(200);

  const checkpointed = checkpointSchema.parse(await checkpoint.json());

  expect(checkpointed.busy).toBeGreaterThanOrEqual(0);
  expect(checkpointed.beforeWalBytes).toBeGreaterThanOrEqual(0);
  expect(checkpointed.afterWalBytes).toBeGreaterThanOrEqual(0);

  if (checkpointed.busy === 0) {
    expect(checkpointed.afterWalBytes).toBeLessThanOrEqual(checkpointed.beforeWalBytes);
  }

  const audit = auditSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit`)).json(),
  );

  const checkpointAudit = audit.audit.find((row) => row.action === "system.wal_checkpoint");

  expect(checkpointAudit).toBeDefined();
  expect(checkpointAudit?.detail["afterWalBytes"]).toBe(checkpointed.afterWalBytes);

  const rerun = await page.request.post(`${adminIsolatedAppUrl}/admin/api/live-checks/run`);

  expect(rerun.status()).toBe(200);
  expect(jobSchema.parse(await rerun.json()).jobId.length).toBeGreaterThan(0);

  const rerunAudit = auditSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit`)).json(),
  );

  expect(rerunAudit.audit.some((row) => row.action === "live-checks.run")).toBe(true);

  const manual = await page.request.post(`${adminIsolatedAppUrl}/admin/api/live-checks`, {
    data: { groups: ["alerts"] },
  });

  expect(manual.status()).toBe(200);
  expect(jobSchema.parse(await manual.json()).jobId.length).toBeGreaterThan(0);

  const manualAudit = auditSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit`)).json(),
  );

  expect(
    manualAudit.audit.some(
      (row) => row.action === "live-checks.run" && row.detail["groups"] === "alerts",
    ),
  ).toBe(true);
});

test("the system page shows the runtime, storage and live check sections", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(180_000);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  await page.goto(`${adminIsolatedAppUrl}/admin/system`);

  await expect(page.getByRole("heading", { level: 1, name: /System/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Runtime and backups" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Databases and storage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live checks" })).toBeVisible();
  await expect(page.getByText("No live check has run yet.")).toBeVisible();

  const seeded = await page.request.post(`${adminIsolatedAppServer.url}/__test__/jobs/run-now`, {
    data: { kind: "live.check", payload: JSON.stringify({ groups: ["alerts"] }) },
  });

  expect(seeded.ok()).toBe(true);

  await page.reload();

  await expect(page.getByText("alert.health", { exact: true })).toBeVisible();
  await expect(page.getByText("Litestream replication")).toBeVisible();
  await expect(page.getByText("app.sqlite", { exact: true })).toBeVisible();
  await expect(page.getByText("catalog.sqlite", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Run live checks now" }).click();
  await expect(page.getByText(/live checks are queued/u)).toBeVisible();

  await page.getByRole("button", { name: "Run WAL checkpoint" }).click();
  await expect(page.getByText(/WAL checkpoint done|checkpoint stayed busy/u)).toBeVisible();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

const shotDirectory = process.env.SYSTEM_SHOT_DIR;
const reviewViewports = [390, 1280] as const;
const reviewThemes = ["light", "dark"] as const;

test.describe("review screenshots", () => {
  test.skip(shotDirectory === undefined, "only when capturing review screenshots");

  for (const width of reviewViewports) {
    for (const theme of reviewThemes) {
      test(`captures the system page at ${String(width)} ${theme}`, async ({
        page,
        adminIsolatedAppServer,
        adminIsolatedAppUrl,
        accessServer,
      }) => {
        test.setTimeout(180_000);

        await page.addInitScript((stored) => {
          globalThis.localStorage.setItem("overture.theme", stored);
        }, theme);
        await page.setViewportSize({ width, height: 844 });
        await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

        const seeded = await page.request.post(
          `${adminIsolatedAppServer.url}/__test__/jobs/run-now`,
          { data: { kind: "live.check", payload: JSON.stringify({ groups: ["alerts"] }) } },
        );

        expect(seeded.ok()).toBe(true);

        await page.goto(`${adminIsolatedAppUrl}/admin/system`);
        await expect(page.getByRole("heading", { level: 1, name: /System/u })).toBeVisible();
        await expect(page.getByText("alert.health", { exact: true })).toBeVisible();
        await page.screenshot({
          fullPage: true,
          path: `${shotDirectory ?? ""}/system-${String(width)}-${theme}.png`,
        });
      });
    }
  }
});
