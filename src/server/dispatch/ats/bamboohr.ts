import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { FORM_APPEAR_MS } from "../forms/engine.ts";
import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * BambooHR renders the application form on the posting's careers page. The one form with the resume upload is filled; any sign-in or newsletter form beside it fails closed instead.
 */
export const BAMBOOHR_FORM_SELECTOR =
  "form#applicationForm, form#application-form, form#job-application-form, form[action*='apply'], form[data-testid='application-form']";

export type BambooHRRunPlan = BrowserFormPlan;

export type BambooHRHooks = BrowserFormHooks;

export type BambooHRRun = BrowserFormRun;

const APPLY_CONTROL = /apply(?: for this job)?/iu;

async function openBambooHRForm(page: Page) {
  const form = page.locator(BAMBOOHR_FORM_SELECTOR).first();
  const apply = page.getByRole("button", { name: APPLY_CONTROL }).first();

  if (await form.isVisible().catch(() => false)) {
    return true;
  }

  try {
    await Promise.race([
      form.waitFor({ state: "visible", timeout: FORM_APPEAR_MS }),
      apply.waitFor({ state: "visible", timeout: FORM_APPEAR_MS }),
    ]);
  } catch {
    return false;
  }

  if (await form.isVisible().catch(() => false)) {
    return true;
  }

  if ((await apply.count()) === 0 || !(await apply.isVisible().catch(() => false))) {
    return false;
  }

  await apply.click({ timeout: 10_000 }).catch(() => undefined);

  try {
    await page.locator(BAMBOOHR_FORM_SELECTOR).first().waitFor({
      state: "visible",
      timeout: FORM_APPEAR_MS,
    });

    return true;
  } catch {
    return false;
  }
}

const BAMBOOHR_CONFIG: BrowserFormConfig = {
  formSelector: BAMBOOHR_FORM_SELECTOR,
  prepare: openBambooHRForm,
  submitSelector: "button[type='submit'][form='job-application-form']",
};

/**
 * Reads the controls of a BambooHR apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readBambooHRQuestions(page: Page) {
  return readFormQuestions(page, BAMBOOHR_CONFIG);
}

export const runBambooHRAttempt: (
  page: Page,
  plan: BambooHRRunPlan,
  hooks: BambooHRHooks,
) => Promise<BambooHRRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, BAMBOOHR_CONFIG);
