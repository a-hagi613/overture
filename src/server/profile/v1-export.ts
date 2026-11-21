import { z } from "zod";

export const V1_EXPORT_FORMAT = "overture-v1-export";

export const V1_EXPORT_VERSION = 1;

const answerEntrySchema = z.object({
  key: z.string().min(1),
  group: z.string(),
  question: z.string(),
  value: z.json(),
  kind: z.enum(["fact", "rule", "self_id"]),
  updatedAt: z.string(),
  ownerEdited: z.boolean(),
});

const answerYearSchema = z.object({
  key: z.string().min(1),
  skill: z.string().min(1),
  years: z.number().nonnegative(),
  position: z.number().int(),
});

const achievementSchema = z.object({
  position: z.number().int(),
  text: z.string().min(1),
});

const answerAliasSchema = z.object({
  labelNorm: z.string().min(1),
  label: z.string().min(1),
  key: z.string().min(1),
  createdAt: z.string(),
});

const answerSettingSchema = z.object({
  name: z.string().min(1),
  value: z.number(),
});

const learnedAnswerSchema = z.object({
  normalizedLabel: z.string().min(1),
  widgetType: z.string().min(1),
  value: z.string(),
  basis: z.string().min(1),
  confidence: z.number(),
  source: z.enum(["model", "owner"]),
  timesUsed: z.number().int().nonnegative(),
  timesCorrected: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const v1ExportSchema = z.object({
  format: z.literal(V1_EXPORT_FORMAT),
  version: z.literal(V1_EXPORT_VERSION),
  exportedAt: z.number().int(),
  answerBank: z.object({
    entries: z.array(answerEntrySchema),
    years: z.array(answerYearSchema),
    achievements: z.array(achievementSchema),
    aliases: z.array(answerAliasSchema),
    settings: z.array(answerSettingSchema),
  }),
  learnedAnswers: z.array(learnedAnswerSchema),
});

export type V1Export = z.infer<typeof v1ExportSchema>;

export type V1AnswerEntry = z.infer<typeof answerEntrySchema>;

export type V1LearnedAnswer = z.infer<typeof learnedAnswerSchema>;

export function parseV1Export(content: string) {
  return v1ExportSchema.parse(JSON.parse(content));
}
