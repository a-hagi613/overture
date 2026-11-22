import type { Page } from "playwright-core";

import type { ProbeConsole } from "./console.ts";
import type { RunFilePosting } from "./run-file.ts";

import {
  APPLICATION_RESPONSE_MS,
  FORM_APPEAR_MS,
  fillField,
  openForm,
  submitButton,
} from "../dispatch/forms/engine.ts";
import type { FormScope } from "../dispatch/forms/engine.ts";
import {
  WORKABLE_FORM_SELECTOR,
  findResumeFileInput,
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

async function fillApprovedQuestions(scope: FormScope, questions: RunFilePosting["questions"]) {
  const filledIds: string[] = [];
  const failedIds: string[] = [];

  const fillFrom = async (index: number) => {
    const question = questions[index];

    if (question === undefined) {
      return;
    }

    const filled = await fillField(scope, question.id, question.value);

    (filled ? filledIds : failedIds).push(question.id);

    await fillFrom(index + 1);
  };

  await fillFrom(0);

  return { failedIds, filledIds };
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

  const scope = await openForm(page, WORKABLE_FORM_SELECTOR, FORM_APPEAR_MS);

  if (scope === null) {
    return emptyAttempt("form_missing", []);
  }

  const { failedIds, filledIds } = await fillApprovedQuestions(scope, posting.questions);

  if (failedIds.length > 0) {
    return { ...emptyAttempt("fill_failed", filledIds), failedIds };
  }

  const { resumeFieldId } = posting;
  const input = await findResumeFileInput(scope, resumeFieldId);

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
    submitButton(scope).click({ timeout: APPLICATION_RESPONSE_MS }),
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

  let outcome: WorkableAttempt["outcome"] = "unconfirmed";

  if (confirmationSeen) {
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
