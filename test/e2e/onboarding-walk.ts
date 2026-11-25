import { expect } from "@playwright/test";

import type { Page } from "@playwright/test";

/**
 * Walk a fresh signed-in user through the 3-step onboarding into the Free Trial Modal:
 * resume upload (with scan), category/role/location/workplace/seniority + optional salary,
 * then matched top-3 preview opening the confirmation dialog.
 * @param page The signed-in page.
 * @param baseUrl The app server's URL.
 */
export async function walkOnboardingSteps1To4(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/onboarding`);
  await expect(page).toHaveURL(/\/onboarding\/resume$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Upload your resume/u })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles("test/e2e/fixtures/resume-text.pdf");
  await expect(page.getByText("resume-text.pdf")).toBeVisible();
  await expect(
    page.getByText("Stored unchanged. Employers receive the exact PDF file you upload."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Job preferences/u })).toBeVisible();

  const roles = page.getByRole("button", { name: "Platform Engineer" });

  if ((await roles.getAttribute("aria-pressed")) === "false") {
    await roles.click();
  }

  await page.getByLabel("Locations").click();
  await page.getByRole("option", { exact: true, name: "London" }).click();
  await page.keyboard.press("Escape");

  const remote = page.getByRole("button", { exact: true, name: "Remote" });
  const senior = page.getByRole("button", { name: "Senior" });

  if ((await remote.getAttribute("aria-pressed")) === "false") {
    await remote.click();
  }

  if ((await senior.getAttribute("aria-pressed")) === "false") {
    await senior.click();
  }

  await page.getByRole("button", { name: /Optional: minimum salary/u }).click();
  await page.getByLabel("Minimum salary").fill("120,000");
  await page.getByLabel("Minimum salary").blur();

  await page.getByRole("button", { name: "See my matches" }).click();
  await expect(page).toHaveURL(/\/onboarding\/matches$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Your matches/u })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("3 of 3 selected");

  await page.getByRole("button", { name: /Apply to these 3 roles for free/u }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Your first 3 applications are free/u }),
  ).toBeVisible();
}
