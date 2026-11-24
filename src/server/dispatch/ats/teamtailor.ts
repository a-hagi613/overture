import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";
import { teamtailorApplyUrl } from "../../pipeline/wave1a-forms.ts";

/**
 * Teamtailor renders the application form on its `/jobs/{id}/applications/new` page. The form with the resume upload is the only one filled; a newsletter or sign-in form beside it is never touched.
 */
export const TEAMTAILOR_FORM_SELECTOR =
  "form#new_candidate, form#application_form, form[action*='/applications'], form[data-testid='application-form']";

export type TeamtailorRunPlan = BrowserFormPlan;

export type TeamtailorHooks = BrowserFormHooks;

export type TeamtailorRun = BrowserFormRun;

const TEAMTAILOR_CONFIG: BrowserFormConfig = {
  applyUrl: teamtailorApplyUrl,
  formSelector: TEAMTAILOR_FORM_SELECTOR,
};

/**
 * Reads the controls of a Teamtailor apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readTeamtailorQuestions(page: Page) {
  return readFormQuestions(page, TEAMTAILOR_CONFIG);
}

export const runTeamtailorAttempt: (
  page: Page,
  plan: TeamtailorRunPlan,
  hooks: TeamtailorHooks,
) => Promise<TeamtailorRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, TEAMTAILOR_CONFIG);
