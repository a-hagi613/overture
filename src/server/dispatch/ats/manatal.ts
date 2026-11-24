import type { Page } from "playwright-core";

import { readFormQuestions, runHostedAttempt } from "./hosted.ts";
import type { HostedHooks, HostedRunPlan } from "./hosted.ts";

/**
 * Manatal career sites render one application form on the job page. The id is
 * the stable anchor; the data-testid form covers the newer career-site layout.
 */
export const MANATAL_FORM_SELECTOR = "form#application-form, form[data-testid='application-form']";

export const readManatalQuestions = async (page: Page) =>
  readFormQuestions(page, MANATAL_FORM_SELECTOR);

export const runManatalAttempt = async (page: Page, plan: HostedRunPlan, hooks: HostedHooks) =>
  runHostedAttempt(page, plan, hooks, { formSelector: MANATAL_FORM_SELECTOR });
