import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * Jobvite serves a data-consent gate in front of its guest application form. The
 * application form is the one Angular form that owns the whole application; a page
 * with a second copy fails closed.
 */
export const JOBVITE_FORM_SELECTOR = "form[name='scopeData.applyForm']";

/** The consent form the apply page shows before the application form. */
export const JOBVITE_CONSENT_SELECTOR = "form[name='consentForm']";

/** The resume control Jobvite portals outside the application form. */
export const JOBVITE_RESUME_SELECTOR = "input[type='file'][id='file-input-0']";

/** The step button Jobvite shows while more form steps remain. */
export const JOBVITE_NEXT_SELECTOR = "button[ng-click='nextStep()']";

const JOBVITE_CLOSED =
  /no longer (?:accepting|available|open)|not accepting applications|position (?:has been )?(?:filled|closed)|this job (?:is|has been) closed/iu;

const FORM_APPEAR_TIMEOUT_MS = 20_000;

/**
 * Turns a Jobvite posting URL into the apply page that carries the consent gate
 * and the preloaded field definitions.
 *
 * @param url The posting or apply URL.
 * @returns The apply URL, or null when the URL is not a Jobvite job page.
 */
export function jobviteApplyUrl(url: string) {
  try {
    const parsed = new URL(url);

    if (!/\/job\/[^/]+/u.test(parsed.pathname)) {
      return null;
    }

    if (/\/apply\/?$/u.test(parsed.pathname)) {
      return parsed.toString();
    }

    parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/apply`;

    return parsed.toString();
  } catch {
    return null;
  }
}

export type JobviteRunPlan = BrowserFormPlan;

export type JobviteHooks = BrowserFormHooks;

export type JobviteRun = BrowserFormRun;

const JOBVITE_CONFIG: BrowserFormConfig = {
  applyUrl: jobviteApplyUrl,
  closed: JOBVITE_CLOSED,
  formSelector: JOBVITE_FORM_SELECTOR,
  loginWall: true,
  nextControl: JOBVITE_NEXT_SELECTOR,
  prepare: acceptJobviteConsent,
  resumeSelector: JOBVITE_RESUME_SELECTOR,
  resumeUploaded: async (page, resume) => {
    try {
      await page.waitForFunction(
        ({ filename, selector }: { filename: string; selector: string }) => {
          const section = document.querySelector(selector);

          return section?.textContent.includes(filename) ?? false;
        },
        { filename: resume.filename, selector: "#attachResume" },
        { timeout: FORM_APPEAR_TIMEOUT_MS },
      );

      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Accepts Jobvite's data-consent gate when the apply page shows one, so the real
 * application form can open. The consent gate never submits an application.
 *
 * @param page The apply page the browser opened.
 * @returns True when the application form is reachable (consent accepted or not shown).
 */
export async function acceptJobviteConsent(page: Page) {
  const consent = page.locator(JOBVITE_CONSENT_SELECTOR);

  if ((await consent.count()) === 0) {
    return true;
  }

  const select = consent.locator("#jv-country-select");

  if ((await select.count()) === 0 || (await select.locator("option").count()) < 2) {
    return false;
  }

  await select.selectOption({ index: 1 });

  const accept = consent.getByRole("button", { name: /^(?:i\s*)?accept$/iu }).first();

  if ((await accept.count()) === 0) {
    return false;
  }

  await accept.click({ timeout: FORM_APPEAR_TIMEOUT_MS });

  try {
    await page.locator(JOBVITE_FORM_SELECTOR).first().waitFor({
      state: "visible",
      timeout: FORM_APPEAR_TIMEOUT_MS,
    });
  } catch {
    return false;
  }

  return (await page.locator(JOBVITE_FORM_SELECTOR).count()) === 1;
}

/**
 * Reads the controls of a Jobvite application page, for the admin capture job.
 *
 * @param page The apply page the browser opened, with the consent gate already accepted.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readJobviteQuestions(page: Page) {
  return readFormQuestions(page, JOBVITE_CONFIG);
}

export const runJobviteAttempt: (
  page: Page,
  plan: JobviteRunPlan,
  hooks: JobviteHooks,
) => Promise<JobviteRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, JOBVITE_CONFIG);
