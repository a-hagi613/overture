import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";
import type { PlanAnswer } from "./answer-plan.ts";

import { applicationAnswers } from "../platform/db/schema.ts";
import { answerIsValid, formatFactValue } from "./answer-value.ts";

const sentencesSchema = z.array(
  z.object({
    byUser: z.boolean().optional(),
    resumeLineIds: z.array(z.string()),
    sentence: z.string().min(1),
  }),
);

/**
 * Reads the answers a person saved for one Application only. These rows live in
 * `application_answers` and never touch the shared facts table, so a
 * company-specific answer cannot leak into another role.
 * @param deps The application database and the person's crypto.
 * @param input The signed-in person and the Application.
 * @returns A map from question id to the stored answer.
 */
export async function readScopedAnswers(
  deps: { db: AppDatabase; personal: PersonalCrypto },
  input: { applicationId: string; userId: string },
) {
  const { db, personal } = deps;

  const rows = db
    .select()
    .from(applicationAnswers)
    .where(
      and(
        eq(applicationAnswers.applicationId, input.applicationId),
        eq(applicationAnswers.kind, "fact"),
      ),
    )
    .all();

  const entries = await Promise.all(
    rows.map(async (row) => {
      const plaintext = await personal.openFor(
        input.userId,
        { table: "application_answers", column: "sentences_enc", rowId: row.id },
        row.sentencesEnc,
      );

      const sentences = sentencesSchema.safeParse(JSON.parse(plaintext));

      if (!sentences.success || sentences.data.length === 0) {
        return null;
      }

      return [
        row.questionId,
        sentences.data.map((sentence) => sentence.sentence).join(" "),
      ] as const;
    }),
  );

  const answers = new Map<string, string>();

  for (const entry of entries) {
    if (entry !== null) {
      answers.set(entry[0], entry[1]);
    }
  }

  return answers;
}

/**
 * The answer a person gave for one Application only, validated the same way a
 * fact would be.
 * @param value The stored answer, or undefined when this Application has none.
 * @param question The posting question the answer belongs to.
 * @returns A resolved answer, or null when there is none or it is invalid.
 */
export function scopedAnswer(
  value: string | undefined,
  question: {
    fieldType: QuestionFieldType;
    options: readonly string[];
    prompt: string;
    questionId: string;
  },
) {
  if (value === undefined) {
    return null;
  }

  const formatted = formatFactValue({
    factKey: `q:${question.questionId}`,
    fieldType: question.fieldType,
    options: question.options,
    questionText: question.prompt,
    value,
  });

  if (formatted === null || !answerIsValid(question.fieldType, question.options, formatted.value)) {
    return null;
  }

  return {
    factRevision: null,
    file: null,
    kind: "answer",
    scope: "",
    source: "fact",
    unit: formatted.unit,
    value: formatted.value,
  } satisfies PlanAnswer;
}
