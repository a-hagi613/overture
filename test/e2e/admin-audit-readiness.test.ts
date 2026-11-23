import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";

async function checkAuditLayout(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });

  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(overflow.scroll, `audit overflow at ${String(width)}px`).toBeLessThanOrEqual(
    overflow.client,
  );

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(axe.violations, `audit axe at ${String(width)}px`).toEqual([]);
}

const auditPageSchema = z.object({
  audit: z.array(
    z.object({
      action: z.string(),
      actorId: z.string(),
      at: z.number(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      id: z.string(),
      reason: z.string(),
      targetUserId: z.string().nullable(),
    }),
  ),
  entries: z.array(
    z.object({
      action: z.string(),
      actorId: z.string(),
      at: z.number(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      id: z.string(),
      reason: z.string(),
      targetUserId: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

const alertsSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      readAt: z.number().nullable(),
      title: z.string(),
    }),
  ),
  problems: z.array(
    z.object({
      code: z.string(),
      id: z.string(),
      severity: z.enum(["critical", "warning"]),
      title: z.string(),
    }),
  ),
  readiness: z.object({
    alertNtfyConfigured: z.boolean(),
    browserConcurrency: z.number(),
    cfAccessConfigured: z.boolean(),
    dailyCap: z.number(),
    publicSignupEnabled: z.boolean(),
    stripeMode: z.enum(["live", "test", "disabled"]),
  }),
  unreadCount: z.number(),
});

test("launch readiness, active alerts ack, and searchable /admin/audit work end-to-end", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  await expect(page.getByRole("heading", { name: "Launch readiness" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active alerts" })).toBeVisible();

  await page.getByRole("button", { name: "Set daily cap to 20" }).click();
  await expect(page.getByText("20 / day")).toBeVisible();

  const invalidResponse = await page.request.put(
    `${adminIsolatedAppUrl}/admin/api/settings/limits.daily_cap`,
    { data: { value: "0" } },
  );

  expect(invalidResponse.status()).toBe(400);

  const drillResponse = await page.request.post(
    `${adminIsolatedAppServer.url}/__test__/live-checks/drill`,
  );

  expect(drillResponse.status()).toBe(200);

  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await expect(page.getByRole("heading", { name: "Launch readiness" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active alerts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Acknowledge all" })).toBeVisible();

  await page.getByRole("button", { name: "Acknowledge all" }).click();
  await expect(page.getByRole("button", { name: "Acknowledge all" })).toBeHidden();

  const alertsAfterAck = alertsSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/alerts`)).json(),
  );

  expect(alertsAfterAck.unreadCount).toBe(0);
  expect(alertsAfterAck.readiness.dailyCap).toBe(20);

  await page.getByRole("link", { name: "View full audit log" }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/u);
  await page.goto(`${adminIsolatedAppUrl}/admin/audit`);
  await expect(page.getByRole("heading", { name: "Admin audit" })).toBeVisible();

  const auditList = page.getByRole("region", { name: "Audit log" });

  await expect(auditList.getByText("alerts.ack")).toBeVisible();

  await page.getByLabel("Action").selectOption("settings.update");
  await expect(auditList.getByText("settings.update")).toBeVisible();
  await expect(auditList.getByText("alerts.ack")).toBeHidden();

  await page.getByLabel("Search audit entries").fill("limits.daily_cap");
  await expect(auditList.getByText("settings.update")).toBeVisible();

  await auditList.getByRole("button", { name: "Details for settings.update" }).first().click();
  await expect(auditList.locator("pre").first()).toContainText('"limits.daily_cap"');

  const page1 = auditPageSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit?limit=1`)).json(),
  );

  expect(page1.entries).toHaveLength(1);
  expect(page1.audit).toHaveLength(1);
  expect(page1.nextCursor).not.toBeNull();

  const page2 = auditPageSchema.parse(
    await (
      await page.request.get(
        `${adminIsolatedAppUrl}/admin/api/audit?limit=1&before=${encodeURIComponent(page1.nextCursor ?? "")}`,
      )
    ).json(),
  );

  expect(page2.entries).toHaveLength(1);
  expect(page2.entries[0]?.id).not.toBe(page1.entries[0]?.id);

  await checkAuditLayout(page, 390);
  await checkAuditLayout(page, 1280);

  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await checkAuditLayout(page, 390);
  await checkAuditLayout(page, 1280);

  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await expect(page.getByRole("heading", { name: "Launch readiness" })).toBeVisible();
  await checkAuditLayout(page, 390);
  await checkAuditLayout(page, 1280);

  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await checkAuditLayout(page, 390);
  await checkAuditLayout(page, 1280);
});
