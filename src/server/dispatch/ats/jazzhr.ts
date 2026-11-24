import type { Page } from "playwright-core";

import { readFormQuestions, runHostedAttempt } from "./hosted.ts";
import type { HostedHooks, HostedRunPlan } from "./hosted.ts";

/**
 * JazzHR's hosted apply page renders one application form. The id is the stable
 * anchor; the data-testid form covers the newer apply layout. No bare `form`
 * fallback: a second form on the page fails closed.
 */
export const JAZZHR_FORM_SELECTOR = "form#application-form, form[data-testid='application-form']";

export const readJazzhrQuestions = async (page: Page) =>
  readFormQuestions(page, JAZZHR_FORM_SELECTOR);

export const runJazzhrAttempt = async (page: Page, plan: HostedRunPlan, hooks: HostedHooks) =>
  runHostedAttempt(page, plan, hooks, { formSelector: JAZZHR_FORM_SELECTOR });
