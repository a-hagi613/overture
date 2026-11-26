import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

test("Applications, Profile, and Follow-ups groups start open, collapse cleanly, and Account menu opens Billing, Settings, Theme, and Sign out", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();

  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(`${appServerUrl}/home`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();

  const aside = page.locator("[data-shell-sidebar]");
  const applicationsToggle = aside.getByRole("button", { name: "Applications" });
  const profileToggle = aside.getByRole("button", { name: "Profile" });
  const followUpsToggle = aside.getByRole("button", { name: "Follow-ups" });

  await expect(applicationsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(profileToggle).toHaveAttribute("aria-expanded", "true");
  await expect(followUpsToggle).toHaveAttribute("aria-expanded", "true");

  await Promise.all(
    ["Resume & Cover Letter", "Job Preferences", "Application Answers"].map(async (item) => {
      await expect(aside.getByRole("link", { name: item })).toBeVisible();
    }),
  );

  await profileToggle.click();
  await expect(profileToggle).toHaveAttribute("aria-expanded", "false");
  await profileToggle.click();
  await expect(profileToggle).toHaveAttribute("aria-expanded", "true");

  await applicationsToggle.click();
  await expect(applicationsToggle).toHaveAttribute("aria-expanded", "false");
  await applicationsToggle.click();
  await expect(applicationsToggle).toHaveAttribute("aria-expanded", "true");

  await followUpsToggle.click();
  await expect(followUpsToggle).toHaveAttribute("aria-expanded", "false");
  await followUpsToggle.click();
  await expect(followUpsToggle).toHaveAttribute("aria-expanded", "true");

  await aside.getByRole("button", { name: /Account menu/u }).click();

  await Promise.all(
    ["Billing", "Account settings"].map(async (item) => {
      await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    }),
  );

  await expect(page.getByRole("menuitem", { name: "Dark mode" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();

  await page.getByRole("menuitem", { name: "Account settings" }).click();
  await expect(page).toHaveURL(/\/profile\/account$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Account Settings" })).toBeVisible();

  const results = await new AxeBuilder({ page }).include("aside").analyze();

  expect(results.violations).toEqual([]);

  await context.close();
});

test("at tablet width (1024px) the Expand sidebar button stays visible and opens the navigation drawer", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();

  await page.setViewportSize({ width: 1024, height: 844 });
  await page.goto(`${appServerUrl}/home`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();

  const expandButton = page
    .locator("[data-shell-sidebar]")
    .getByRole("button", { name: "Expand sidebar" });

  await expect(expandButton).toBeVisible();
  await expandButton.click();

  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });

  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Applications" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Profile" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Follow-ups" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Account menu/u })).toBeVisible();

  await drawer.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(drawer).toBeHidden();

  await context.close();
});

for (const width of [390, 1024, 1280]) {
  test(`the Profile Account Settings screen causes no horizontal overflow at ${String(width)}px`, async ({
    browser,
    appServerUrl,
    ownerStorageState,
  }) => {
    const context = await browser.newContext({ storageState: ownerStorageState });
    const page = await context.newPage();

    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${appServerUrl}/profile/account`);
    await expect(page.getByRole("heading", { level: 1, name: "Account Settings" })).toBeVisible();

    if (width >= 1280) {
      await page
        .locator("[data-shell-sidebar]")
        .getByRole("button", { name: /Account menu/u })
        .click();
    }

    const overflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));

    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

    await context.close();
  });
}

const homeQuotaSchema = z.object({
  applicationsLeft: z.number(),
  dailyCap: z.number(),
  planApplications: z.number(),
  planKind: z.enum(["month", "none", "trial", "week"]),
  sentToday: z.number(),
});

const PLAN_BADGE = {
  month: "Monthly",
  none: "Free plan",
  trial: "Free trial",
  week: "Weekly",
} as const;

const workspaceSearchSchema = z.object({
  applications: z.array(z.unknown()),
  emails: z.array(z.unknown()),
  interviews: z.array(z.unknown()),
  reviews: z.array(z.unknown()),
});

test("sidebar search queries the backend, usage card reflects /api/home quota, theme persists, and billing navigates cleanly", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({
    storageState: ownerStorageState,
    viewport: { width: 1280, height: 844 },
  });

  const page = await context.newPage();

  const homeResponsePromise = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${appServerUrl}/api/home`) && response.status() === 200,
  );

  await page.goto(`${appServerUrl}/home`);

  const homeQuota = homeQuotaSchema.parse(await (await homeResponsePromise).json());
  const aside = page.locator("[data-shell-sidebar]");

  const balanceCard = aside.getByTestId("sidebar-balance");

  await expect(balanceCard.getByText("Balance", { exact: true })).toBeVisible();
  await expect(
    balanceCard.getByText(PLAN_BADGE[homeQuota.planKind], { exact: true }),
  ).toBeVisible();
  await expect(
    balanceCard.getByText(
      `${String(homeQuota.applicationsLeft)} applications left · ${String(homeQuota.sentToday)} of ${String(homeQuota.dailyCap)} today`,
    ),
  ).toBeVisible();

  await aside.getByRole("button", { name: /^Search/u }).click();

  const searchDialog = page.getByRole("dialog", { name: "Search" });

  await expect(searchDialog).toBeVisible();
  await Promise.all(
    [
      "Resume & Cover Letter",
      "Job Preferences",
      "Application Answers",
      "Billing",
      "Account settings",
    ].map(async (label) => expect(searchDialog.getByText(label, { exact: true })).toBeVisible()),
  );

  const searchResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/workspace/search") &&
      response.url().includes("engineer") &&
      response.status() === 200,
  );

  await searchDialog.getByRole("combobox").fill("engineer");
  const searchPayload = workspaceSearchSchema.parse(await (await searchResponsePromise).json());

  expect(Array.isArray(searchPayload.applications)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(searchDialog).toBeHidden();

  await aside.getByRole("button", { name: /Account menu/u }).click();
  await page.getByRole("menuitem", { name: /Dark mode/u }).click();
  await expect(page.getByRole("menuitem", { name: /Light mode/u })).toBeVisible();

  await page.reload();
  await aside.getByRole("button", { name: /Account menu/u }).click();
  await expect(page.getByRole("menuitem", { name: /Light mode/u })).toBeVisible();
  await page.getByRole("menuitem", { name: "Billing" }).click();
  await expect(page).toHaveURL(/\/profile\/billing$/u);

  await context.close();
});
