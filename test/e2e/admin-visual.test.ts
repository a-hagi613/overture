import { enableVirtualAuthenticator, signInOwnerOnAdmin } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
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
  ).toBeVisible();

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

  await enableVirtualAuthenticator(page);
  await signInOwnerOnAdmin(page, adminIsolatedAppUrl);

  const token = await accessServer.issueToken({ email: authTestIdentity.ownerEmail });

  await page.context().addCookies([
    {
      name: "CF_Authorization",
      value: token,
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await page.getByRole("button", { name: "Add your passkey" }).click();
  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();

  const state = await page.context().storageState();

  state.cookies.push({
    name: "CF_Authorization",
    value: token,
    domain: "localhost",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  });

  await Promise.all(
    combinations().map(async (check) => {
      await checkPage(browser, adminIsolatedAppUrl, state, check);
    }),
  );
});
