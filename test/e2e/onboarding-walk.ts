import { expect } from "@playwright/test";

import type { Page } from "@playwright/test";

interface GapValue {
  label: string;
  select?: boolean;
  value: string;
}

async function fillGap(page: Page, entry: GapValue) {
  const field = page.getByLabel(entry.label, { exact: true });
  const current = await field.inputValue();

  if (current.trim() !== "") {
    return;
  }

  if (entry.select === true) {
    await field.selectOption(entry.value);
  } else {
    await field.fill(entry.value);
  }
}

/**
 * Completes the fill-the-gaps step with whatever the resume left empty.
 * @param page The signed-in page, already on /onboarding/gaps.
 */
export async function completeOnboardingGaps(page: Page) {
  await expect(page).toHaveURL(/\/onboarding\/gaps$/u);
  await expect(page.getByRole("heading", { level: 2, name: "Fill the gaps" })).toBeVisible();

  await fillGap(page, { label: "First and last name", value: "Jordan Taylor" });
  await fillGap(page, { label: "Email", value: "jordan.taylor@example.com" });
  await fillGap(page, { label: "Phone", value: "+1 416 555 0100" });
  await fillGap(page, { label: "City", value: "Toronto" });
  await fillGap(page, { label: "Country", value: "Canada" });
  await fillGap(page, {
    label: "Legally allowed to work in the country",
    select: true,
    value: "Yes",
  });
  await fillGap(page, { label: "Needs sponsorship", select: true, value: "No" });
  await fillGap(page, { label: "Salary expectation", value: "CAD 120,000 a year" });
  await fillGap(page, { label: "Notice period or earliest start", value: "Two weeks" });
  await fillGap(page, { label: "Willing to relocate", select: true, value: "Yes" });
  await fillGap(page, { label: "Languages and proficiency level", value: "English (fluent)" });

  await page.getByRole("button", { name: "Save and continue" }).click();
}

/**
 * Walk a fresh signed-in user through the 3-step onboarding into the Free Trial Modal:
 * resume upload (with scan), fill-the-gaps details, category/role/location/workplace/seniority
 * plus optional salary, then matched top-3 preview opening the confirmation dialog.
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

  await completeOnboardingGaps(page);

  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Job preferences/u })).toBeVisible();

  const roles = page.getByRole("button", { exact: true, name: "DevOps / SRE / Platform Engineer" });

  if ((await roles.getAttribute("aria-pressed")) === "false") {
    await roles.click();
  }

  await page.getByLabel("Locations").click();
  await page.getByPlaceholder("Search cities or remote regions...").fill("London");
  await page
    .getByRole("option", { name: /^London/u })
    .first()
    .click();

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
