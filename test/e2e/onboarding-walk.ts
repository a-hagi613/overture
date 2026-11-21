import { expect } from "@playwright/test";

import type { Page } from "@playwright/test";

async function actInTurn<Item>(items: readonly Item[], act: (item: Item) => Promise<void>) {
  const first = items.at(0);

  if (first === undefined) {
    return;
  }

  await act(first);
  await actInTurn(items.slice(1), act);
}

/**
 * Walk a fresh signed-in user through onboarding steps 1 to 4 in the real UI, with a mock PDF,
 * and stop on step 5 (Forward your job mail).
 * @param page The signed-in page.
 * @param baseUrl The app server's URL.
 */
export async function walkOnboardingSteps1To4(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/onboarding`);
  await expect(page.getByRole("heading", { level: 2, name: /Welcome to Overture/u })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/resume$/u);
  await page.locator('input[type="file"]').setInputFiles("test/e2e/fixtures/resume-text.pdf");
  await expect(page.getByText("resume-text.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/facts$/u);
  await expect(page.getByLabel("Current job title")).toBeVisible();
  await expect(page.getByText("0 of 0 answered")).toHaveCount(0);

  const workAuth = page.getByLabel(/^Work authorisation in /u);
  const salary = page.getByLabel(/^Salary expectation in /u);

  await expect(workAuth.first()).toBeVisible();
  await expect(salary.first()).toBeVisible();

  await page.getByLabel("Current job title").fill("Staff Platform Engineer");

  await actInTurn(await workAuth.all(), async (field) => {
    await field.selectOption("Citizen");
  });
  await actInTurn(await salary.all(), async (field) => {
    await field.fill("140,000");
  });
  await actInTurn(await page.getByLabel(/^Period for /u).all(), async (field) => {
    await field.selectOption("a year");
  });

  await page.getByRole("switch").click();
  await expect(page.getByLabel("Gender")).toBeEnabled();
  await page.getByLabel("Gender").selectOption("Woman");
  await page.getByLabel("How did you hear about us?").fill("A friend");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await expect(page.getByRole("heading", { level: 2, name: /What do you want/u })).toBeVisible();
  await page.getByRole("button", { name: "Platform Engineer" }).click();
  await page.getByRole("button", { name: "London" }).click();
  await page.getByRole("button", { exact: true, name: "Remote" }).click();
  await page.getByRole("button", { name: "Senior" }).click();
  await expect(page.getByTestId("targets-match-count")).not.toHaveText("0");

  await page.getByLabel("Salary floor").fill("120,000");
  await page.getByLabel("Salary floor").blur();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/forward$/u);
}
