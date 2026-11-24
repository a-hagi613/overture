import { z } from "zod";

import { ANSWER_KINDS, QUESTION_FIELD_TYPES } from "../../shared/questions.ts";
import { APPLY_SUPPORTED_ATS } from "../../shared/ats.ts";
import type { ApplySupportedAts } from "../../shared/ats.ts";
import { ANSWER_SOURCES, BLOCK_REASONS } from "./answer-plan.ts";
import { ANSWER_PERIODS, FILE_FACTS } from "./answer-value.ts";

import type { AnswerKind, QuestionFieldType } from "../../shared/questions.ts";
import type { AnswerSource, BlockReason } from "./answer-plan.ts";
import type { AnswerUnit, FileFact } from "./answer-value.ts";

export interface PlannedSentence {
  sentence: string;
  resumeLineIds: string[];
  byUser?: boolean | undefined;
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
  source: AnswerSource | null;
  file: FileFact | null;
  unit: AnswerUnit | null;
  block: BlockReason | null;
}

export interface SendPlanResume {
  id: string;
  sha256: string;
  filename: string;
}

export interface FormQuestion {
  fieldName: string;
  label: string;
  fieldType: QuestionFieldType;
  required: boolean;
  options: string[];
}

export interface SendPlan {
  applicationId: string;
  userId: string;
  ats: ApplySupportedAts;
  companyName: string;
  boardToken: string;
  atsJobId: string;
  postingUrl: string;
  postingTitle: string;
  descriptionHash: string | null;
  consentVersion: string;
  coverLetter: PlannedSentence[] | null;
  fields: SendPlanField[];
  resume: SendPlanResume | null;
}

const plannedSentenceSchema = z.object({
  byUser: z.boolean().optional(),
  resumeLineIds: z.array(z.string()),
  sentence: z.string(),
});

const answerUnitSchema = z.object({
  currency: z.string().nullable(),
  period: z.enum(ANSWER_PERIODS).nullable(),
});

export const sendPlanFieldSchema = z.object({
  answer: z.string().nullable(),
  answerKind: z.enum(ANSWER_KINDS),
  block: z.enum(BLOCK_REASONS).nullable(),
  factKey: z.string().nullable(),
  factRevision: z.number().int().nullable(),
  fieldName: z.string().nullable(),
  fieldType: z.enum(QUESTION_FIELD_TYPES),
  file: z.enum(FILE_FACTS).nullable(),
  label: z.string(),
  options: z.array(z.string()),
  questionId: z.string(),
  required: z.boolean(),
  scope: z.string(),
  sentences: z.array(plannedSentenceSchema),
  source: z.enum(ANSWER_SOURCES).nullable(),
  unit: answerUnitSchema.nullable(),
});

export const sendPlanSchema = z.object({
  applicationId: z.string(),
  ats: z.enum(APPLY_SUPPORTED_ATS),
  atsJobId: z.string(),
  boardToken: z.string(),
  companyName: z.string(),
  consentVersion: z.string(),
  coverLetter: z.array(plannedSentenceSchema).nullable(),
  descriptionHash: z.string().nullable(),
  fields: z.array(sendPlanFieldSchema),
  postingTitle: z.string(),
  postingUrl: z.string(),
  resume: z
    .object({
      filename: z.string(),
      id: z.string(),
      sha256: z.string(),
    })
    .nullable(),
  userId: z.string(),
});
