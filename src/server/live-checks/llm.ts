import { z } from "zod";

import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmBatchCall, LlmOutputSchema, LlmPort, LlmRequest } from "../platform/ports/llm.ts";
import type { LiveCheckResult } from "./types.ts";

import { MODEL_ANSWER_KINDS } from "../../shared/questions.ts";
import { failedResult } from "./types.ts";

const SCORE_SCHEMA: LlmOutputSchema = {
  type: "object",
  properties: {
    score: { type: "number", description: "Fit from 0 to 100." },
    reason: { type: "string", description: "One line, 140 characters or fewer." },
  },
  required: ["score", "reason"],
  additionalProperties: false,
};

const OPEN_TEXT_SCHEMA: LlmOutputSchema = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          resume_line_ids: { type: "array", items: { type: "string" } },
        },
        required: ["text", "resume_line_ids"],
      },
    },
  },
  required: ["sentences"],
  additionalProperties: false,
};

const MAPPING_SCHEMA: LlmOutputSchema = {
  type: "object",
  properties: {
    answer_kind: { type: "string", enum: [...MODEL_ANSWER_KINDS] },
    fact_key: { type: "string" },
  },
  required: ["answer_kind", "fact_key"],
  additionalProperties: false,
};

const TAG_SCHEMA: LlmOutputSchema = {
  type: "object",
  properties: {
    role: { type: "string" },
    subrole: { type: "string" },
  },
  required: ["role", "subrole"],
  additionalProperties: false,
};

const scoreOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string().min(1).max(140),
});

const openTextOutputSchema = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string().min(1),
        resume_line_ids: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

const mappingOutputSchema = z.object({
  answer_kind: z.enum(MODEL_ANSWER_KINDS),
  fact_key: z.string(),
});

const tagOutputSchema = z.object({
  role: z.string().min(1),
  subrole: z.string().nullable(),
});

const RESUME_LINES: readonly string[] = ["L4", "L6", "L7", "L9", "L10", "L11"];

const OPEN_TEXT_QUESTION = "Why do you want to work at Northwind Labs?";

const REQUESTS: readonly LlmRequest[] = [
  {
    customId: "live-check-score",
    purpose: "score",
    system:
      "You score how well a job posting fits one candidate's resume. Return the JSON the tool requests, with no other text.",
    user: [
      "title: Senior Backend Engineer",
      "company: Northwind Labs",
      "location: Toronto, Canada",
      "workplace: remote",
      "employment: full_time",
      "salary: CAD 150000",
      "tags: Backend | senior",
      "summary: Build and operate the public API on Go and Postgres.",
      "resume: L4 based in Toronto, authorised to work in Canada.",
    ].join("\n"),
    schema: SCORE_SCHEMA,
  },
  {
    customId: "live-check-open-text",
    purpose: "open_text",
    system:
      "You write one application answer from the resume lines given. Every sentence cites the resume lines that support it. Return the JSON the tool requests, with no other text.",
    user: [
      `question: ${OPEN_TEXT_QUESTION}`,
      "kind: open_text",
      "resume:",
      "L4 Based in Toronto, authorised to work in Canada.",
      "L6 Available to start within two weeks.",
      "L7 Canadian work authorisation.",
      "L9 BSc in Computer Science, graduated in 2019.",
      "L10 Led a team of engineers at Brightwave Analytics.",
      "L11 Speak English and French.",
    ].join("\n"),
    schema: OPEN_TEXT_SCHEMA,
  },
  {
    customId: "live-check-question-mapping",
    purpose: "question_mapping",
    system:
      "You map one employer application question to the candidate's fixed fact catalog. Return the JSON the tool requests, with no other text.",
    user: ["question: Are you available to start within four weeks?", "options: free text"].join(
      "\n",
    ),
    schema: MAPPING_SCHEMA,
  },
  {
    customId: "live-check-tag",
    purpose: "tag_fallback",
    system:
      "You classify job postings by role group. Return the JSON the tool requests, with no other text.",
    user: [
      "company: Northwind Labs",
      "title: Wardrobe Stylist Coordinator",
      "department: none",
      "description: Coordinate wardrobe fittings and styling for a retail campaign.",
    ].join("\n"),
    schema: TAG_SCHEMA,
  },
];

export interface LlmCheckDeps {
  clock: Clock;
  llm: LlmPort;
  objects: ObjectStore;
}

function assertCall(call: LlmBatchCall) {
  if (!call.result.ok) {
    throw new Error(call.result.error);
  }

  const { value } = call.result;

  if (call.customId === "live-check-score") {
    scoreOutputSchema.parse(value);

    return;
  }

  if (call.customId === "live-check-open-text") {
    const output = openTextOutputSchema.parse(value);

    for (const sentence of output.sentences) {
      for (const lineId of sentence.resume_line_ids) {
        if (!RESUME_LINES.some((candidate) => candidate === lineId)) {
          throw new Error(`open text cited an unknown resume line: ${lineId}`);
        }
      }
    }

    return;
  }

  if (call.customId === "live-check-question-mapping") {
    mappingOutputSchema.parse(value);

    return;
  }

  tagOutputSchema.parse(value);
}

export async function runLlmCheck(deps: LlmCheckDeps) {
  const startedAt = deps.clock.now();
  const results: LiveCheckResult[] = [];

  try {
    const calls = await deps.llm.runBatch(REQUESTS);

    const key = `recordings/anthropic/live-check-${String(startedAt)}.jsonl`;

    await deps.objects.put(
      key,
      new TextEncoder().encode(
        calls
          .map((call) =>
            JSON.stringify({
              customId: call.customId,
              model: call.model,
              result: call.result,
              inputTokens: call.inputTokens,
              cachedTokens: call.cachedTokens,
              cacheWriteTokens: call.cacheWriteTokens,
              outputTokens: call.outputTokens,
            }),
          )
          .join("\n"),
      ),
    );

    const failures: string[] = [];

    for (const request of REQUESTS) {
      const call = calls.find((candidate) => candidate.customId === request.customId);

      if (call === undefined) {
        failures.push(`${request.customId}: no call returned`);

        continue;
      }

      try {
        assertCall(call);
      } catch (error) {
        failures.push(
          `${request.customId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    results.push({
      check: "llm",
      ok: failures.length === 0,
      startedAt,
      durationMs: deps.clock.now() - startedAt,
      detail: {
        calls: calls.length,
        error: failures.length === 0 ? null : failures.join("; "),
        recordingsKey: key,
        requested: REQUESTS.length,
      },
    });
  } catch (error) {
    results.push(
      failedResult(
        "llm",
        startedAt,
        error instanceof Error ? error.message : String(error),
        deps.clock.now() - startedAt,
      ),
    );
  }

  return results;
}
