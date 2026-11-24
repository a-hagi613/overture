import type { Page } from "playwright-core";

import { readFormQuestions, runHostedAttempt } from "./hosted.ts";
import type { HostedHooks, HostedRunPlan } from "./hosted.ts";

/**
 * SmartRecruiters' hosted apply page renders one application form. The id is the
 * stable anchor; the data-testid form covers the oneclick apply layout. There is
 * no bare `form` fallback, so a newsletter or duplicate form fails closed.
 */
export const SMART_RECRUITERS_FORM_SELECTOR =
  "form#application-form, form[data-testid='application-form']";

export const readSmartRecruitersQuestions = async (page: Page) =>
  readFormQuestions(page, SMART_RECRUITERS_FORM_SELECTOR);

export const runSmartRecruitersAttempt = async (
  page: Page,
  plan: HostedRunPlan,
  hooks: HostedHooks,
) => runHostedAttempt(page, plan, hooks, { formSelector: SMART_RECRUITERS_FORM_SELECTOR });
