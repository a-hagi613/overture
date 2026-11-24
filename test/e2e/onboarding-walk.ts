import { expect } from "@playwright/test";

import type { Page } from "@playwright/test";

/**
 * Walk a fresh signed-in user through the value-first onboarding in the real UI, with a mock
 * PDF: resume, preferences, then the live match preview with three picks. Stops on the trial gate.
 * @param page The signed-in page.
 * @param baseUrl The app server's URL.
 */
export async function walkOnboardingSteps1To4(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/onboarding`);
  await expect(page).toHaveURL(/\/onboarding\/resume$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Upload your resume/u })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles("test/e2e/fixtures/resume-text.pdf");
  await expect(page.getByText("resume-text.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Job preferences/u })).toBeVisible();

  const roles = page.getByRole("button", { name: "Platform Engineer" });
  const locations = page.getByRole("button", { name: "London" });
  const remote = page.getByRole("button", { exact: true, name: "Remote" });
  const senior = page.getByRole("button", { name: "Senior" });

  if ((await roles.getAttribute("aria-pressed")) === "false") {
    await roles.click();
  }

  if ((await locations.getAttribute("aria-pressed")) === "false") {
    await locations.click();
  }

  if ((await remote.getAttribute("aria-pressed")) === "false") {
    await remote.click();
  }

  if ((await senior.getAttribute("aria-pressed")) === "false") {
    await senior.click();
  }

  await expect(page.getByTestId("targets-match-count")).not.toHaveText("0");
  await page.getByLabel("Minimum salary").fill("120,000");
  await page.getByLabel("Minimum salary").blur();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/matches$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Your matches/u })).toBeVisible();

  const picks = page.getByRole("button", { name: /^Select /u });

  await expect(picks.first()).toBeVisible();
  await picks.first().click();
  await picks.first().click();
  await picks.first().click();
  await expect(page.getByRole("status")).toContainText("3 of 3 selected");

  await page.getByRole("button", { name: /Prepare & review my first 3/u }).click();
  await expect(page).toHaveURL(/\/onboarding\/trial$/u);
}
