import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import type { Browser, BrowserContext } from "@playwright/test";

import { AxeBuilder } from "@axe-core/playwright";

interface AdminGateCheck {
  width: number;
  theme: string;
  path: string;
}

const widths = [390, 1280];
const themes = ["light", "dark"];

const adminPaths = [
  "/admin",
  "/admin/jobs",
  "/admin/settings",
  "/admin/catalog",
  "/admin/grants",
  "/admin/users",
  "/admin/invites",
  "/admin/mail-health",
  "/admin/provider-report",
  "/admin/attempts",
  "/admin/llm",
  "/admin/billing",
  "/admin/audit",
];

function combinations() {
  return widths.flatMap((width) =>
    themes.flatMap((theme) => adminPaths.map((path) => ({ width, theme, path }))),
  );
}

const CHECKS_PER_BATCH = 4;

const HEADING_TIMEOUT_MS = 15_000;

async function runBatches(
  browser: Browser,
  adminIsolatedAppUrl: string,
  state: Awaited<ReturnType<BrowserContext["storageState"]>>,
  remaining: readonly AdminGateCheck[],
) {
  if (remaining.length === 0) {
    return;
  }

  await Promise.all(
    remaining
      .slice(0, CHECKS_PER_BATCH)
      .map(async (check) => checkPage(browser, adminIsolatedAppUrl, state, check)),
  );

  await runBatches(browser, adminIsolatedAppUrl, state, remaining.slice(CHECKS_PER_BATCH));
}

async function checkPage(
  browser: Browser,
  adminIsolatedAppUrl: string,
  state: Awaited<ReturnType<BrowserContext["storageState"]>>,
  check: AdminGateCheck,
) {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();

  await page.addInitScript((stored) => {
    globalThis.localStorage.setItem("overture.theme", stored);
  }, check.theme);
  await page.setViewportSize({ width: check.width, height: 844 });
  await page.goto(`${adminIsolatedAppUrl}${check.path}`);

  await expect(
    page
      .getByRole("heading", { name: "Background jobs" })
      .or(page.getByRole("heading", { name: "Kill switches" }))
      .or(page.getByRole("heading", { name: "Job board sources" }))
      .or(page.getByRole("heading", { name: "Recent grants" }))
      .or(page.getByRole("heading", { name: "Users and access" }))
      .or(page.getByRole("heading", { name: "Invites", exact: true }))
      .or(page.getByRole("heading", { name: "Mail health" }))
      .or(page.getByRole("heading", { name: "The provider report" }))
      .or(page.getByRole("heading", { name: "Live attempts" }))
      .or(page.getByRole("heading", { name: "LLM spend" }))
      .or(page.getByRole("heading", { name: "Billing", exact: true }))
      .or(page.getByRole("heading", { name: "Admin audit" }))
      .first(),
  ).toBeVisible({ timeout: HEADING_TIMEOUT_MS });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${check.width}px ${check.theme} ${check.path}`).toEqual([]);

  await context.close();
}

test("the admin pages are axe clean at 390 and 1280 in light and dark", async ({
  browser,
  page,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(120_000);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const state = await page.context().storageState();

  await runBatches(browser, adminIsolatedAppUrl, state, combinations());
});
