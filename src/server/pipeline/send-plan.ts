import type { AnswerKind, QuestionFieldType } from "../../shared/questions.ts";

export interface PlannedSentence {
  sentence: string;
  resumeLineIds: string[];
}

export interface SendPlanField {
  questionId: string;
  label: string;
  fieldName: string | null;
  fieldType: QuestionFieldType;
  answerKind: AnswerKind;
  required: boolean;
  options: string[];
  answer: string | null;
  factKey: string | null;
  factRevision: number | null;
  scope: string;
  sentences: PlannedSentence[];
}

export interface SendPlanResume {
  id: string;
  sha256: string;
  filename: string;
}

export interface SendPlan {
  applicationId: string;
  userId: string;
  ats: "greenhouse" | "lever" | "ashby";
  companyName: string;
  postingUrl: string;
  postingTitle: string;
  descriptionHash: string | null;
  consentVersion: string;
  coverLetter: PlannedSentence[] | null;
  fields: SendPlanField[];
  resume: SendPlanResume | null;
}
