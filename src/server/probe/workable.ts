import type { Page } from "playwright-core";

import type { ProbeConsole } from "./console.ts";
import type { RunFilePosting } from "./run-file.ts";

import { APPLICATION_RESPONSE_MS, FORM_APPEAR_MS, fillField } from "../dispatch/forms/engine.ts";
import {
  WORKABLE_FORM_SELECTOR,
  WORKABLE_SUBMIT_SELECTOR,
  workableConfirmationSeen,
} from "../dispatch/ats/workable.ts";

export interface WorkableAttempt {
  outcome: "dry_run_filled" | "fill_failed" | "sent" | "unconfirmed" | "blocked" | "form_missing";
  filledIds: string[];
  failedIds: string[];
  resumeUploaded: boolean;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
}

const messages = {
  uploadRefused: (id: string) => `the resume input ${id} refused the upload`,
};

const emptyAttempt = (outcome: WorkableAttempt["outcome"], filledIds: string[]) =>
  ({
    outcome,
    filledIds,
    failedIds: [],
    resumeUploaded: false,
    submitResponseStatus: null,
    confirmationSeen: false,
  }) satisfies WorkableAttempt;

async function fillApprovedQuestions(page: Page, questions: RunFilePosting["questions"]) {
  const filledIds: string[] = [];
  const failedIds: string[] = [];

  const fillFrom = async (index: number) => {
    const question = questions[index];

    if (question === undefined) {
      return;
    }

    const filled = await fillField(page, question.id, question.value);

    (filled ? filledIds : failedIds).push(question.id);

    await fillFrom(index + 1);
  };

  await fillFrom(0);

  return { failedIds, filledIds };
}

async function resumeInput(page: Page, fieldId: string) {
  const named = page
    .locator(`input[type="file"][name="${fieldId}"], input[type="file"][id="${fieldId}"]`)
    .first();

  if ((await named.count()) > 0) {
    return named;
  }

  const first = page.locator("input[type='file']").first();

  return (await first.count()) > 0 ? first : null;
}

export async function probeWorkable(
  page: Page,
  posting: RunFilePosting,
  applicationUrl: string,
  resumePath: string,
  io: ProbeConsole,
  confirm: boolean,
) {
  await page.goto(applicationUrl, { waitUntil: "domcontentloaded" });

  try {
    await page
      .locator(WORKABLE_FORM_SELECTOR)
      .first()
      .waitFor({ state: "visible", timeout: FORM_APPEAR_MS });
  } catch {
    return emptyAttempt("form_missing", []);
  }

  const { failedIds, filledIds } = await fillApprovedQuestions(page, posting.questions);

  if (failedIds.length > 0) {
    return { ...emptyAttempt("fill_failed", filledIds), failedIds };
  }

  const { resumeFieldId } = posting;
  const input = await resumeInput(page, resumeFieldId);

  if (input === null) {
    throw new Error(messages.uploadRefused(resumeFieldId));
  }

  const filename = resumePath.slice(resumePath.lastIndexOf("/") + 1) || "resume.pdf";

  try {
    await input.setInputFiles({
      buffer: Buffer.from(new Uint8Array(await Bun.file(resumePath).arrayBuffer())),
      mimeType: "application/pdf",
      name: filename,
    });
  } catch {
    throw new Error(messages.uploadRefused(resumeFieldId));
  }

  if (!confirm) {
    return { ...emptyAttempt("dry_run_filled", filledIds), resumeUploaded: true };
  }

  const { origin } = new URL(applicationUrl);

  const settled = await Promise.allSettled([
    page.locator(WORKABLE_SUBMIT_SELECTOR).first().click({ timeout: APPLICATION_RESPONSE_MS }),
    page.waitForResponse(
      (candidate) => {
        if (candidate.request().method() !== "POST") {
          return false;
        }

        const url = new URL(candidate.url());

        return url.origin === origin && !url.pathname.startsWith("/__fixture__");
      },
      { timeout: APPLICATION_RESPONSE_MS },
    ),
  ]);

  const [clickOutcome, response] = settled;
  const status = response.status === "fulfilled" ? response.value.status() : null;

  if (clickOutcome.status === "rejected") {
    return {
      ...emptyAttempt("fill_failed", filledIds),
      resumeUploaded: true,
      submitResponseStatus: status,
    };
  }

  const confirmationSeen =
    status !== null && status < 400 ? await workableConfirmationSeen(page) : false;

  const accepted = status !== null && status >= 200 && status < 300;

  let outcome: WorkableAttempt["outcome"] = "unconfirmed";

  if (confirmationSeen || accepted) {
    outcome = "sent";
  } else if (status !== null && status >= 400) {
    outcome = "blocked";
  }

  return {
    ...emptyAttempt(outcome, filledIds),
    resumeUploaded: true,
    submitResponseStatus: status,
    confirmationSeen,
  };
}
