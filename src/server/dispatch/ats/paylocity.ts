import type { Page } from "playwright-core";

import { readFormQuestions, runHostedAttempt } from "./hosted.ts";
import type { HostedHooks, HostedRunPlan } from "./hosted.ts";

/**
 * Paylocity's recruiting portal renders its application form on the Apply page.
 * The id is the stable anchor; the data-testid form covers the newer layout.
 * Paylocity employers may require a candidate account, so this board always
 * runs the WS-2b login-wall pre-flight before anything is filled.
 */
export const PAYLOCITY_FORM_SELECTOR =
  "form#applicationForm, form[data-testid='apply-form'], form#application-form";

export const readPaylocityQuestions = async (page: Page) =>
  readFormQuestions(page, PAYLOCITY_FORM_SELECTOR);

export const runPaylocityAttempt = async (page: Page, plan: HostedRunPlan, hooks: HostedHooks) =>
  runHostedAttempt(page, plan, hooks, {
    formSelector: PAYLOCITY_FORM_SELECTOR,
    loginWall: true,
  });
