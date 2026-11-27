import type { Page } from "playwright-core";

import { readFormQuestions, runHostedAttempt } from "./hosted.ts";
import type { HostedHooks, HostedRunPlan } from "./hosted.ts";

/**
 * JazzHR's hosted apply page renders one application form. Two ids anchor the
 * classic and the live apply layouts; the data-testid form covers the newer one.
 * The live page (CMHA Thames Valley, #786) uses `form_submit_new_resume`. No bare
 * `form` fallback: a second form on the page fails closed.
 */
export const JAZZHR_FORM_SELECTOR =
  "form#application-form, form[data-testid='application-form'], form#form_submit_new_resume";

/**
 * The live JazzHR form submits through an anchor (`#resumator-submit-resume`)
 * rather than a button, so the board names it in addition to the generic pair.
 */
export const JAZZHR_SUBMIT_SELECTOR =
  "#resumator-submit-resume, button[type='submit'], input[type='submit']";

export const readJazzhrQuestions = async (page: Page) =>
  readFormQuestions(page, JAZZHR_FORM_SELECTOR);

export const runJazzhrAttempt = async (page: Page, plan: HostedRunPlan, hooks: HostedHooks) =>
  runHostedAttempt(page, plan, hooks, {
    formSelector: JAZZHR_FORM_SELECTOR,
    submitSelector: JAZZHR_SUBMIT_SELECTOR,
  });
