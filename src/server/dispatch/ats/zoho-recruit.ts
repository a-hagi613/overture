import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * Zoho Recruit renders the application form on the posting's careers page. The form with the resume upload is the only one filled; the careers search and sign-in forms beside it are never touched.
 */
export const ZOHO_RECRUIT_FORM_SELECTOR =
  "form#application_form, form#apply-form, form[action*='apply'], form[data-testid='application-form']";

export type ZohoRecruitRunPlan = BrowserFormPlan;

export type ZohoRecruitHooks = BrowserFormHooks;

export type ZohoRecruitRun = BrowserFormRun;

const ZOHO_RECRUIT_CONFIG: BrowserFormConfig = {
  formSelector: ZOHO_RECRUIT_FORM_SELECTOR,
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
