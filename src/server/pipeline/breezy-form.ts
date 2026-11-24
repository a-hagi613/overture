import { createHash } from "node:crypto";

import { z } from "zod";

import type { FormQuestion } from "./send-plan.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";

const QUESTION_ID = "_id";

const cleanOption = (value: string) => value.replaceAll(/\s+/gu, " ").trim();

const portalQuestionSchema = z.object({
  [QUESTION_ID]: z.union([z.string(), z.number()]).optional(),
  options: z
    .array(
      z.union([
        z.string().transform(cleanOption),
        z
          .object({ text: z.string().optional() })
          .transform((value) => cleanOption(value.text ?? "")),
      ]),
    )
    .optional(),
  required: z.boolean().optional(),
  text: z.string().optional(),
  type: z
    .union([
      z.string().transform((value) => value.trim().toLowerCase()),
      z
        .object({ id: z.string().optional() })
        .transform((value) => (value.id ?? "").trim().toLowerCase()),
    ])
    .optional(),
});

const portalGroupSchema = portalQuestionSchema.extend({
  questions: z.array(portalQuestionSchema).optional(),
});

const portalDataSchema = z.object({
  data: z.object({
    questions: z.array(portalGroupSchema).optional(),
  }),
});

const PORTAL_DATA = /<script[^>]*id="portal-data"[^>]*>(?<json>[\s\S]*?)<\/script>/iu;

const BREEZY_FIELD_TYPES: ReadonlyMap<string, QuestionFieldType> = new Map([
  ["boolean", "radio"],
  ["checkboxes", "multiselect"],
  ["date", "date"],
  ["dropdown", "select"],
  ["email", "email"],
  ["file", "file"],
  ["longtext", "textarea"],
  ["multiple_choice", "radio"],
  ["multiplechoice", "radio"],
  ["multiselect", "multiselect"],
  ["number", "number"],
  ["phone", "phone"],
  ["radio", "radio"],
  ["select", "select"],
  ["singleselect", "select"],
  ["tel", "phone"],
  ["text", "text"],
  ["textarea", "textarea"],
  ["upload", "file"],
  ["url", "url"],
  ["yesno", "radio"],
]);

export interface BreezyFormRead {
  questions: FormQuestion[];
  formSignature: string;
  path: "breezy_json";
}

function questionFrom(
  raw: z.infer<typeof portalQuestionSchema>,
  position: number,
  unhandled: string[],
) {
  const label = (raw.text ?? "").replaceAll(/\s+/gu, " ").trim();

  if (label === "") {
    return null;
  }

  const rawType = raw.type ?? "";
  const fieldType = BREEZY_FIELD_TYPES.get(rawType);

  if (fieldType === undefined) {
    unhandled.push(`${label}: ${rawType === "" ? "unknown" : rawType}`);

    return null;
  }

  const fieldName = String(raw[QUESTION_ID] ?? "").trim() || `question_${position + 1}`;
  const options = (raw.options ?? []).filter((text) => text !== "");

  return {
    fieldName,
    fieldType,
    label,
    options: fieldType === "radio" && options.length === 0 ? ["Yes", "No"] : options,
    required: raw.required === true,
  };
}

/**
 * Reads Breezy's questionnaire from the `#portal-data` payload on its apply page.
 *
 * @param rawHtml the server response for a Breezy posting's apply page
 * @returns the questions and signature, or null when the page has no readable payload
 */
export const readBreezyFormHtml: (rawHtml: string) => BreezyFormRead | null = (rawHtml) => {
  const match = PORTAL_DATA.exec(rawHtml);

  if (match?.groups?.["json"] === undefined) {
    return null;
  }

  let json: unknown;

  try {
    json = JSON.parse(match.groups.json);
  } catch {
    return null;
  }

  const parsed = portalDataSchema.safeParse(json);

  if (!parsed.success) {
    return null;
  }

  const unhandled: string[] = [];
  const questions: FormQuestion[] = [];
  const seen = new Set<string>();

  for (const group of parsed.data.data.questions ?? []) {
    const entries = group.questions ?? [group];

    for (const entry of entries) {
      const question = questionFrom(entry, questions.length, unhandled);

      if (question === null || seen.has(question.fieldName)) {
        continue;
      }

      seen.add(question.fieldName);
      questions.push(question);
    }
  }

  if (questions.length === 0) {
    return null;
  }

  return {
    questions,
    formSignature: formSignatureForQuestions(questions),
    path: "breezy_json",
  };
};

function formSignatureForQuestions(questions: readonly Pick<FormQuestion, "fieldName">[]) {
  return createHash("sha256")
    .update(
      `breezy_json\n${questions
        .map((question) => question.fieldName)
        .toSorted()
        .join("\n")}`,
    )
    .digest("hex")
    .slice(0, 16);
}
