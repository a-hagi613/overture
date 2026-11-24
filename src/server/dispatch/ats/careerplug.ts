import type { Page } from "playwright-core";

import { readFormQuestions, runHostedAttempt } from "./hosted.ts";
import type { HostedHooks, HostedRunPlan } from "./hosted.ts";

/**
 * CareerPlug renders the application as a Rails `new_application` form. The id
 * is the stable anchor; the data-testid form covers the newer layout, and a bare
 * `form` fallback is deliberately absent so a decoy form fails closed.
 */
export const CAREERPLUG_FORM_SELECTOR =
  "form#new_application, form[data-testid='application-form']";

export const readCareerplugQuestions = async (page: Page) =>
  readFormQuestions(page, CAREERPLUG_FORM_SELECTOR);

export const runCareerplugAttempt = async (page: Page, plan: HostedRunPlan, hooks: HostedHooks) =>
  runHostedAttempt(page, plan, hooks, { formSelector: CAREERPLUG_FORM_SELECTOR });
