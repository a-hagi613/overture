import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmOutputSchema, LlmPort, LlmRequest } from "../platform/ports/llm.ts";

import { MODEL_ANSWER_KINDS } from "../../shared/questions.ts";
import { FACT_KEYS } from "../../shared/facts.ts";
import { checkLlmCaps } from "../platform/llm/caps.ts";
import { recordLlmUsage } from "../platform/llm/usage.ts";
import { raiseAlert } from "../platform/alerts.ts";

export const QUESTION_MAPPING_PURPOSE = "question_mapping";

const OUTPUT_SCHEMA: LlmOutputSchema = {
  type: "object",
  properties: {
    answer_kind: {
      type: "string",
      enum: [...MODEL_ANSWER_KINDS],
      description:
        "How the question is answered: a saved fact, generated open text, a standard consent, a blank, or unknown.",
    },
    fact_key: {
      type: "string",
      description: "One fact key when answer_kind is fact, otherwise an empty string.",
    },
  },
  required: ["answer_kind", "fact_key"],
  additionalProperties: false,
};

const outputSchema = z.object({
  answer_kind: z.enum(MODEL_ANSWER_KINDS),
  fact_key: z.string(),
});

const SYSTEM_PROMPT = [
  "You map one employer application question to the candidate's fixed fact catalog.",
  "Choose answer_kind fact only when one fact below answers the question directly, and name that fact key.",
  "Choose open_text for a free-text question about motivation, experience or a cover letter.",
  "Choose consent only for a privacy notice, data-processing acknowledgement or an accuracy confirmation.",
  "Choose skip for marketing, messaging opt-ins, newsletters and job alerts.",
  "Choose unknown when no fact answers it and it is not one of the above. Never guess.",
  `Fact keys: ${FACT_KEYS.join(", ")}.`,
  "Return the JSON the tool requests, with no other text.",
].join(" ");

type MappingOutput = z.infer<typeof outputSchema>;

export function mappingRequest(input: {
  customId: string;
  question: string;
  options: readonly string[];
}) {
  return {
    purpose: QUESTION_MAPPING_PURPOSE,
    customId: input.customId,
    system: SYSTEM_PROMPT,
    user: [
      `question: ${input.question}`,
      `options: ${input.options.length === 0 ? "free text" : input.options.join(" | ")}`,
    ].join("\n"),
    schema: OUTPUT_SCHEMA,
  } satisfies LlmRequest;
}

export function validFactKey(key: string) {
  return FACT_KEYS.some((candidate) => candidate === key);
}

export function mappingFromOutput(output: MappingOutput) {
  if (output.answer_kind !== "fact") {
    return { answerKind: output.answer_kind, factKey: null };
  }

  if (!validFactKey(output.fact_key)) {
    return { answerKind: "unknown" as const, factKey: null };
  }

  return { answerKind: "fact" as const, factKey: output.fact_key };
}

export async function mapQuestionsWithLlm(
  deps: { db: AppDatabase; clock: Clock; llm: LlmPort },
  entries: readonly { id: string; text: string; options: readonly string[] }[],
  apply: (
    questionId: string,
    mapping: { answerKind: MappingOutput["answer_kind"]; factKey: string | null },
  ) => void,
) {
  if (entries.length === 0) {
    return;
  }

  const requests = entries.map((entry, index) =>
    mappingRequest({
      customId: `question-mapping-${String(index)}`,
      question: entry.text,
      options: entry.options,
    }),
  );

  const estimated = deps.llm.estimateBatchCostMicros(requests);

  const caps = checkLlmCaps(deps.db, deps.clock, {
    userId: null,
    purpose: QUESTION_MAPPING_PURPOSE,
    estimatedCostMicros: estimated,
  });

  if (!caps.withinCaps) {
    raiseAlert(deps.db, deps.clock, "llm.cap", {
      cap: caps.exceeded,
      purpose: QUESTION_MAPPING_PURPOSE,
      spentMicros: caps.spentMicros,
      estimatedMicros: estimated,
      capMicros: caps.capMicros,
      questionsWaiting: entries.length,
    });

    return;
  }

  const calls = await deps.llm.runBatch(requests);
  const byCustomId = new Map<string, MappingOutput>();

  for (const call of calls) {
    recordLlmUsage(deps.db, deps.clock, {
      batch:
        call.batchRecordId === undefined
          ? undefined
          : { customId: call.customId, recordId: call.batchRecordId },
      userId: null,
      purpose: QUESTION_MAPPING_PURPOSE,
      model: call.model,
      inputTokens: call.inputTokens,
      cachedTokens: call.cachedTokens,
      outputTokens: call.outputTokens,
      costMicros: call.costMicros,
    });

    const parsed = outputSchema.safeParse(call.result.ok ? call.result.value : null);

    if (parsed.success) {
      byCustomId.set(call.customId, parsed.data);
    }
  }

  for (const [index, entry] of entries.entries()) {
    const output = byCustomId.get(`question-mapping-${String(index)}`);

    if (output !== undefined) {
      apply(entry.id, mappingFromOutput(output));
    }
  }
}
