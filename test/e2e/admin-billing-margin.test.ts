import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { seedApplication, seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";
import { verifyAuthState } from "./sign-in.ts";

const marginSchema = z.object({
  completed: z.number(),
  costMicrosPerCompleted: z.number().nullable(),
  plans: z.array(
    z.object({
      plan: z.enum(["trial", "week", "month"]),
      applications: z.number(),
      users: z.number(),
      completed: z.number(),
      costMicrosPerCompleted: z.number().nullable(),
      revenueMicrosPerApplication: z.number(),
      marginMicrosPerApplication: z.number().nullable(),
      marginRatio: z.number().nullable(),
      costGateMet: z.boolean().nullable(),
    }),
  ),
  beside: z.object({
    fixedInfraMicrosPerMonth: z.number(),
    mail: z.object({
      sends: z.number(),
      includedSends: z.number(),
      overageMicros: z.number(),
    }),
    otherAnthropicMicros: z.number(),
  }),
});

const widths = [390, 1280];
const themes = ["light", "dark"];

async function seedOwnerHistory(page: Page, adminAppUrl: string) {
  const owner = await apiRequest.newContext({ baseURL: adminAppUrl });
  const state = await verifyAuthState(adminAppUrl, page.request);
  const userId = state.users.find((user) => user.email === authTestIdentity.ownerEmail)?.id ?? "";

  expect(userId).not.toBe("");

  const granted = await owner.post("/__test__/ledger/grant", {
    data: {
      email: authTestIdentity.ownerEmail,
      idempotencyKey: `period:${crypto.randomUUID()}`,
      quantity: 70,
      source: "period",
    },
  });

  expect(granted.ok()).toBe(true);

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const postingId = await seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    title: "Assistant General Manager | Durham",
    url: "https://example.test/blankstreet/jobs/8004209003",
  });

  const applicationId = await seedApplication(owner, { postingId, status: "sent", userId });

  const attempt = async (outcome: "sent" | "timeout" | "posting_closed", costMicros: number) => {
    const seeded = await owner.post("/__test__/attempts/seed", {
      data: {
        applicationId,
        browserMs: 60_000,
        costMicros,
        outcome,
        proxyBytes: 0,
        provider: "browser_use",
        userId,
      },
    });

    expect(seeded.ok()).toBe(true);
  };

  await attempt("sent", 20_000);
  await attempt("timeout", 10_000);
  await attempt("posting_closed", 5000);

  const llm = async (purpose: string, costMicros: number) => {
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

  await llm("score", 3000);
  await llm("tag_fallback", 900_000);
}

test("cost and margin per plan come from attempts and model calls, and Anthropic spend is inside the Application cost", async ({
  page,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  await seedOwnerHistory(page, adminIsolatedAppUrl);

  const response = await page.request.get(`${adminIsolatedAppUrl}/admin/api/margin`);

  expect(response.ok()).toBe(true);

  const report = marginSchema.parse(await response.json());
  const week = report.plans.find((row) => row.plan === "week");

  expect(report.completed).toBe(1);
  expect(report.costMicrosPerCompleted).toBe(33_000);
  expect(week).toMatchObject({
    applications: 70,
    users: 1,
    completed: 1,
    costMicrosPerCompleted: 33_000,
    revenueMicrosPerApplication: 171_429,
    marginMicrosPerApplication: 138_429,
    costGateMet: false,
  });
  expect(week?.marginRatio).toBeCloseTo(138_429 / 171_429, 6);
  expect(report.plans.find((row) => row.plan === "trial")).toMatchObject({
    users: 0,
    costMicrosPerCompleted: null,
    marginRatio: null,
  });
  expect(report.beside.otherAnthropicMicros).toBe(900_000);
});

for (const width of widths) {
  for (const theme of themes) {
    test(`the margin page renders at ${String(width)} ${theme} with no overflow and no axe violations`, async ({
      page,
      adminIsolatedAppUrl,
      accessServer,
    }) => {
      await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
      await seedOwnerHistory(page, adminIsolatedAppUrl);
      await page.addInitScript((stored) => {
        globalThis.localStorage.setItem("overture.theme", stored);
      }, theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${adminIsolatedAppUrl}/admin/billing/margin`);

      await expect(page.getByRole("heading", { name: "Cost and margin" })).toBeVisible();
      await expect(page.getByText("Over $0.03").filter({ visible: true }).first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations).toEqual([]);
    });
  }
}

test("the margin page shows the measured numbers and marks the unbuilt billing sections as not links", async ({
  page,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  await seedOwnerHistory(page, adminIsolatedAppUrl);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${adminIsolatedAppUrl}/admin/billing/margin`);

  await expect(page.getByRole("link", { name: "Cost and margin" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("navigation", { name: "Billing sections" }).getByRole("link"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("navigation", { name: "Billing sections" }).getByRole("link", { name: "Users" }),
  ).toHaveAttribute("href", "/admin/billing");
  await expect(page.getByText("$0.033").first()).toBeVisible();
  await expect(page.getByText("81%").first()).toBeVisible();
  await expect(page.getByText("n/a").first()).toBeVisible();
});
