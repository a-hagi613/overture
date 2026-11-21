import type { FormQuestion, SendPlanField } from "../../pipeline/send-plan.ts";

export interface PlannedResume {
  fieldName: string | null;
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export type FormQuestionsResult =
  | { kind: "continue"; fields: readonly SendPlanField[] }
  | { kind: "needs_review" };

export interface FormQuestionHooks {
  onFormQuestions: (questions: readonly FormQuestion[]) => Promise<FormQuestionsResult>;
}

export const cssValue = (raw: string) => raw.replaceAll(/["\\]/gu, String.raw`\$&`);

export const normText = (raw: string | null) =>
  (raw ?? "").replaceAll(/\s+/gu, " ").trim().toLowerCase();
