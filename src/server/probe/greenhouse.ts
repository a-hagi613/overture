import type { Page } from "playwright-core";

import type { ProbeConsole } from "./console.ts";
import type { RunFilePosting } from "./run-file.ts";

import {
  codeStepVisible,
  fillField,
  formLocator,
  readConfirmation,
  submitButton,
  typeCode,
  uploadFile,
  watchApplicationResponse,
} from "../dispatch/forms/engine.ts";

export interface GreenhouseAttempt {
  outcome:
    | "dry_run_filled"
    | "fill_failed"
    | "sent"
    | "unconfirmed"
    | "code_refused"
    | "form_missing";
  filledIds: string[];
  failedIds: string[];
  resumeUploaded: boolean;
  codeAsked: boolean;
  codeResponseStatus: number | null;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
}

const messages = {
  uploadRefused: (id: string) => `the resume input ${id} refused the upload`,
};

const acceptedStatus = (status: number | null) => status !== null && status >= 200 && status < 300;

const attemptStructure = {
  empty: (outcome: GreenhouseAttempt["outcome"], filledIds: string[]) => ({
    outcome,
    filledIds,
    failedIds: [],
    resumeUploaded: false,
    codeAsked: false,
    codeResponseStatus: null,
    submitResponseStatus: null,
    confirmationSeen: false,
  }),
};

const fillQuestionsInOrder = async (page: Page, questions: RunFilePosting["questions"]) => {
  const filledIds: string[] = [];
  const failedIds: string[] = [];

  const fillFrom = async (index: number) => {
    if (index >= questions.length) {
      return;
    }

    const question = questions[index];

    if (question === undefined) {
      await fillFrom(index + 1);

      return;
    }

    const filled = await fillField(page, question.id, question.value);

    (filled ? filledIds : failedIds).push(question.id);

    await fillFrom(index + 1);
  };

  await fillFrom(0);

  return { filledIds, failedIds };
};

export async function probeGreenhouse(
  page: Page,
  posting: RunFilePosting,
  applicationUrl: string,
  resumePath: string,
  io: ProbeConsole,
  confirm: boolean,
) {
  await page.goto(applicationUrl, { waitUntil: "domcontentloaded" });

  try {
    await formLocator(page).waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    return attemptStructure.empty("form_missing", []);
  }

  const { filledIds, failedIds } = await fillQuestionsInOrder(page, posting.questions);

  if (failedIds.length > 0) {
    return { ...attemptStructure.empty("fill_failed", filledIds), failedIds };
  }

  const resumeUploaded = await uploadFile(page, posting.resumeFieldId, {
    bytes: new Uint8Array(await Bun.file(resumePath).arrayBuffer()),
    mimeType: "application/pdf",
    name: resumePath.split("/").at(-1) ?? "resume.pdf",
  });

  if (!resumeUploaded) {
    throw new Error(messages.uploadRefused(posting.resumeFieldId));
  }

  if (!confirm) {
    return { ...attemptStructure.empty("dry_run_filled", filledIds), resumeUploaded };
  }

  const response = await Promise.allSettled([
    submitButton(page).click(),
    watchApplicationResponse(page),
  ]).then((settled) => settled[1]);

  const firstStatus = response.status === "fulfilled" ? response.value.status() : null;
  const codeResponseStatus = firstStatus === 428 ? 428 : null;

  if (!(await codeStepVisible(page))) {
    const confirmed = await readConfirmation(page);
    const sent = confirmed || acceptedStatus(firstStatus);

    return {
      ...attemptStructure.empty(sent ? "sent" : "unconfirmed", filledIds),
      resumeUploaded,
      codeResponseStatus,
      submitResponseStatus: firstStatus,
      confirmationSeen: confirmed,
    };
  }

  io.writeLine("");
  io.writeLine("Greenhouse asked for an emailed verification code.");
  io.writeLine("Open the inbox on this address, read the code, type it here and press Enter.");
  io.writeLine("");

  const typed = await io.readLine();

  await typeCode(page, typed);

  const second = await Promise.allSettled([
    submitButton(page).click(),
    watchApplicationResponse(page),
  ]).then((settled) => settled[1]);

  const secondStatus = second.status === "fulfilled" ? second.value.status() : null;
  const confirmed = await readConfirmation(page);

  if (secondStatus !== null && secondStatus >= 400) {
    return {
      ...attemptStructure.empty("code_refused", filledIds),
      resumeUploaded,
      codeAsked: true,
      codeResponseStatus,
      submitResponseStatus: secondStatus,
    };
  }

  return {
    ...attemptStructure.empty(
      confirmed || acceptedStatus(secondStatus) ? "sent" : "unconfirmed",
      filledIds,
    ),
    resumeUploaded,
    codeAsked: true,
    codeResponseStatus,
    submitResponseStatus: secondStatus,
    confirmationSeen: confirmed,
  };
}
