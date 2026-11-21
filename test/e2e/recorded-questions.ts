import { readFileSync } from "node:fs";

import { z } from "zod";

const recordedQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      label: z.string(),
      required: z.boolean(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          values: z.array(z.object({ label: z.string() })).default([]),
        }),
      ),
    }),
  ),
});

export function recordedQuestions(company: string, atsJobId: string) {
  const path = `test/e2e/fixtures/greenhouse/${company}/jobs/${atsJobId}.questions.json`;

  return recordedQuestionsSchema
    .parse(JSON.parse(readFileSync(path, "utf8")))
    .questions.flatMap((question) => {
      const field = question.fields.at(0);

      if (field === undefined) {
        return [];
      }

      return [
        {
          atsFieldType: field.type,
          fieldName: field.name,
          options: field.values.map((value) => value.label),
          required: question.required,
          text: question.label,
        },
      ];
    });
}

export type SeedQuestion = ReturnType<typeof recordedQuestions>[number];
