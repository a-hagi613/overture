export const QUESTION_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "radio",
  "checkbox",
  "file",
  "date",
  "number",
  "email",
  "phone",
  "url",
] as const;

export type QuestionFieldType = (typeof QUESTION_FIELD_TYPES)[number];

export const ANSWER_KINDS = ["fact", "open_text", "consent", "skip", "unknown"] as const;

export type AnswerKind = (typeof ANSWER_KINDS)[number];

export const QUESTION_MAPPERS = ["rules", "llm", "owner"] as const;

export type QuestionMapper = (typeof QUESTION_MAPPERS)[number];

export const REVIEW_REASONS = ["unknown_required", "option_missing"] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REVIEW_CATEGORIES = [
  "availability",
  "experience",
  "work_authorization",
  "links",
  "languages",
  "identity",
  "eeo",
  "other",
] as const;

export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

export const OPTION_FIELD_TYPES: readonly QuestionFieldType[] = [
  "select",
  "multiselect",
  "radio",
  "checkbox",
];
