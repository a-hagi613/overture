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
 * Zoho Recruit renders the application form on the posting's careers page. The form with the resume upload is the only one filled; the careers search and sign-in forms beside it are never touched.
 */
export const ZOHO_RECRUIT_FORM_SELECTOR =
  "form#application_form, form#apply-form, form[action*='apply'], form[data-testid='application-form'], form:has(input[name^='rec-form_'])";

export type ZohoRecruitRunPlan = BrowserFormPlan;

export type ZohoRecruitHooks = BrowserFormHooks;

export type ZohoRecruitRun = BrowserFormRun;

async function openZohoRecruitForm(page: Page) {
  const form = page.locator(ZOHO_RECRUIT_FORM_SELECTOR).first();

  if (await form.isVisible().catch(() => false)) {
    return true;
  }

  const consent = page.getByRole("button", { name: /accept all/iu }).first();

  if ((await consent.count()) > 0 && (await consent.isVisible().catch(() => false))) {
    await consent.click({ timeout: 5000 }).catch(() => undefined);
  }

  const interested = page
    .getByText("I'm interested", { exact: false })
    .or(page.getByText("I’m interested", { exact: false }))
    .first();

  if ((await interested.count()) > 0 && (await interested.isVisible().catch(() => false))) {
    await interested.click({ timeout: 10_000 }).catch(() => undefined);
  }

  try {
    await form.waitFor({
      state: "visible",
      timeout: FORM_APPEAR_MS,
    });

    return true;
  } catch {
    return false;
  }
}

const ZOHO_RECRUIT_CONFIG: BrowserFormConfig = {
  formSelector: ZOHO_RECRUIT_FORM_SELECTOR,
  prepare: openZohoRecruitForm,
};

/**
 * Reads the controls of a Zoho Recruit apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readZohoRecruitQuestions(page: Page) {
  return readFormQuestions(page, ZOHO_RECRUIT_CONFIG);
}

export const runZohoRecruitAttempt: (
  page: Page,
  plan: ZohoRecruitRunPlan,
  hooks: ZohoRecruitHooks,
) => Promise<ZohoRecruitRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, ZOHO_RECRUIT_CONFIG);
