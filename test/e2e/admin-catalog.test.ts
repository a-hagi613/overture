import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";

const importReportSchema = z.object({
  id: z.string(),
  source: z.string(),
  fileSha256: z.string(),
  rows: z.number(),
  matched: z.number(),
  unmatched: z.number(),
  appliedAt: z.number(),
});

const tagImportsSchema = z.object({
  tagImports: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      fileSha256: z.string(),
      rows: z.number(),
      matched: z.number(),
      uploadedBy: z.string(),
      appliedAt: z.number(),
    }),
  ),
});

const postingTagsSchema = z.object({
  postingTags: z.array(
    z.object({
      postingId: z.string(),
      dimension: z.string(),
      value: z.string(),
      source: z.string(),
    }),
  ),
});

const auditSchema = z.object({
  audit: z.array(
    z.object({
      id: z.string(),
      at: z.number(),
      actorId: z.string(),
      action: z.string(),
      targetUserId: z.string().nullable(),
      reason: z.string(),
      detail: z.unknown(),
    }),
  ),
});

const createResponseSchema = z.object({ id: z.string() });

const llmUsageSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      userId: z.string().nullable(),
      purpose: z.string(),
      model: z.string(),
      inputTokens: z.number(),
      cachedTokens: z.number(),
      outputTokens: z.number(),
      costMicros: z.number(),
      createdAt: z.number(),
    }),
  ),
  totals: z.object({
    calls: z.number(),
    inputTokens: z.number(),
    cachedTokens: z.number(),
    outputTokens: z.number(),
    costMicros: z.number(),
  }),
});

const APPLY_URL = "https://boards.example/tagco/jobs/7401";

async function seedPosting(appUrl: string) {
  const companyResponse = await fetch(`${appUrl}/__test__/catalog/companies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Fixture Dynamics" }),
  });

  const company = createResponseSchema.parse(await companyResponse.json());

  const boardResponse = await fetch(`${appUrl}/__test__/catalog/boards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyId: company.id,
      ats: "greenhouse",
      boardToken: "tagimport-admin",
    }),
  });

  const board = createResponseSchema.parse(await boardResponse.json());

  const postingResponse = await fetch(`${appUrl}/__test__/catalog/postings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      boardId: board.id,
      companyId: company.id,
      ats: "greenhouse",
      atsJobId: "7401",
      url: APPLY_URL,
      title: "Full Stack Developer",
    }),
  });

  return createResponseSchema.parse(await postingResponse.json());
}

test("a tag import posted from admin applies to matched postings and writes an audit row", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  const posting = await seedPosting(adminIsolatedAppServer.url);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const content = [
    JSON.stringify({
      apply_url: APPLY_URL,
      title: "Full Stack Developer",
      company: "Fixture Dynamics",
      role: "Software Engineering",
      subrole: "Backend",
      seniority: "senior",
    }),
    JSON.stringify({
      apply_url: "https://boards.example/nowhere/jobs/9999",
      title: "Ghost Role",
      company: "Nobody",
      role: "Sales",
    }),
  ].join("\n");

  const reportResponse = await page.request.post(`${adminIsolatedAppUrl}/admin/api/tag-imports`, {
    data: { content },
  });

  expect(reportResponse.status()).toBe(200);

  const report = importReportSchema.parse(await reportResponse.json());

  expect(report.rows).toBe(2);
  expect(report.matched).toBe(1);
  expect(report.unmatched).toBe(1);
  expect(report.source).toBe("hiring.cafe");

  const tagsResponse = await fetch(`${adminIsolatedAppServer.url}/__test__/catalog/posting-tags`);

  const tags = postingTagsSchema
    .parse(await tagsResponse.json())
    .postingTags.filter((row) => row.postingId === posting.id);

  expect(tags.length).toBe(3);

  for (const row of tags) {
    expect(row.source).toBe("import");
  }

  const role = tags.find((row) => row.dimension === "role");
  const seniority = tags.find((row) => row.dimension === "seniority");

  expect(role?.value).toBe("Software Engineering");
  expect(seniority?.value).toBe("senior");

  const importsResponse = await fetch(`${adminIsolatedAppServer.url}/__test__/tag-imports`);
  const imports = tagImportsSchema.parse(await importsResponse.json());

  expect(imports.tagImports.length).toBe(1);
  expect(imports.tagImports[0]?.id).toBe(report.id);
  expect(imports.tagImports[0]?.uploadedBy).not.toBe("owner");

  const auditResponse = await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit`);
  const audit = auditSchema.parse(await auditResponse.json());
  const importAudit = audit.audit.find((row) => row.action === "tag_imports.create");

  expect(importAudit?.reason).toContain("hiring.cafe");
  expect(importAudit?.actorId).toBe(imports.tagImports[0]?.uploadedBy);
});

test("the admin tag import is refused without the admin gates", async ({
  request,
  adminIsolatedAppUrl,
}) => {
  const refused = await request.post(`${adminIsolatedAppUrl}/admin/api/tag-imports`, {
    data: { content: JSON.stringify({ apply_url: APPLY_URL }) },
  });

  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "access_required" });
});

test("the admin LLM usage query is behind the owner gate and filters by purpose", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  const seedBody = JSON.stringify({
    purpose: "tagging",
    model: "claude-haiku",
    inputTokens: 1200,
    cachedTokens: 300,
    outputTokens: 40,
    costMicros: 2500,
  });

  const otherBody = JSON.stringify({
    purpose: "industry",
    model: "claude-haiku",
    inputTokens: 500,
    cachedTokens: 0,
    outputTokens: 10,
    costMicros: 500,
  });

  await fetch(`${adminIsolatedAppServer.url}/__test__/llm/usage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: seedBody,
  });
  await fetch(`${adminIsolatedAppServer.url}/__test__/llm/usage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: otherBody,
  });

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const usageResponse = await page.request.get(
    `${adminIsolatedAppUrl}/admin/api/llm-usage?purpose=tagging`,
  );

  expect(usageResponse.status()).toBe(200);

  const usage = llmUsageSchema.parse(await usageResponse.json());

  expect(usage.rows.length).toBe(1);
  expect(usage.rows[0]?.purpose).toBe("tagging");
  expect(usage.totals.calls).toBe(1);
  expect(usage.totals.inputTokens).toBe(1200);
  expect(usage.totals.cachedTokens).toBe(300);
  expect(usage.totals.outputTokens).toBe(40);
  expect(usage.totals.costMicros).toBe(2500);

  const allUsageResponse = await page.request.get(`${adminIsolatedAppUrl}/admin/api/llm-usage`);

  expect(allUsageResponse.status()).toBe(200);

  const allUsage = llmUsageSchema.parse(await allUsageResponse.json());

  expect(allUsage.rows.length).toBe(2);
  expect(allUsage.totals.costMicros).toBe(3000);
});

test("the admin LLM usage query is refused without the admin gates", async ({
  request,
  adminIsolatedAppUrl,
}) => {
  const refused = await request.get(`${adminIsolatedAppUrl}/admin/api/llm-usage`);

  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "access_required" });
});

test("the classification card says so plainly when the active catalog has no report", async ({
  page,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  await page.goto(`${adminIsolatedAppUrl}/admin/catalog`);

  await expect(page.getByRole("heading", { name: "Classification" })).toBeVisible();
  await expect(
    page.getByText("No classification report is attached to the active catalog yet."),
  ).toBeVisible();
});

test("the classification card renders the published tier funnel and Tier 3 spend", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  mkdirSync(join(adminIsolatedAppServer.objectsRoot, "catalog"), { recursive: true });
  writeFileSync(
    join(adminIsolatedAppServer.objectsRoot, "catalog", "latest.json"),
    JSON.stringify({
      version: "2026-11-24",
      tagging: {
        total_postings: 849_612,
        cross_board_dupes_removed: 41_002,
        unique_title_dept_pairs: 312_004,
        cache_hit: 210_100,
        tier1_esco_rules: 80_000,
        tier2_embeddings: 18_500,
        tier3_haiku_batch_sent: 412,
        tier3_haiku_resolved: 3402,
        still_untagged: 12_004,
        input_tokens: 5_200_000,
        output_tokens: 310_000,
        tier3_cost_usd: 6.71,
      },
    }),
  );

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  await page.goto(`${adminIsolatedAppUrl}/admin/catalog`);

  const card = page.locator("section", { hasText: "Classification" });

  await expect(card.getByText("Catalog 2026-11-24")).toBeVisible();
  await expect(card.getByText("849,612", { exact: true })).toBeVisible();
  await expect(card.getByText("80,000", { exact: true })).toBeVisible();
  await expect(card.getByText("3,402", { exact: true })).toBeVisible();
  await expect(card.getByText("12,004", { exact: true })).toBeVisible();
  await expect(card.getByText("$6.71", { exact: true })).toBeVisible();
  await expect(card.getByText("5,200,000 input · 310,000 output tokens")).toBeVisible();

  const results = await new AxeBuilder({ page }).include("#admin-catalog-tagging").analyze();

  expect(results.violations).toEqual([]);
});
