import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { DegradedFlagReader } from "../platform/degraded.ts";
import type { LlmOutputSchema, LlmPort, LlmRequest } from "../platform/ports/llm.ts";
import type { SpendGate } from "../billing/spend.ts";

import { checkLlmCaps } from "../platform/llm/caps.ts";
import { recordLlmUsage } from "../platform/llm/usage.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { logInfo } from "../platform/log.ts";
import { ungatedSpend } from "../billing/spend.ts";
import type { MailClassification } from "./codes.ts";

export const EMAIL_CLASSIFY_PURPOSE = "email_classify";

export const EMAIL_CLASSIFICATIONS = [
  "ack",
  "rejection",
  "screening",
  "interview",
  "offer",
  "other",
] as const;

const OUTPUT_SCHEMA: LlmOutputSchema = {
  type: "object",
  properties: {
    classification: {
      type: "string",
      enum: [...EMAIL_CLASSIFICATIONS],
      description:
        "What the employer email says about the application, or other when it is unclear.",
    },
  },
  required: ["classification"],
  additionalProperties: false,
};

const outputSchema = z.object({
  classification: z.enum(EMAIL_CLASSIFICATIONS),
});

const SYSTEM_PROMPT = [
  "You classify one employer email about a job application into a single label.",
  "ack means the employer received the application; rejection means it will not proceed;",
  "screening means a short introductory call; interview means a scheduled or offered interview;",
  "offer means an offer of employment; other means the email says none of these clearly.",
  "Choose other rather than guessing. Return the JSON the tool requests, with no other text.",
].join(" ");

export const CLASSIFY_TEXT_LIMIT = 1000;

export function emailClassifyRequest(input: { customId: string; subject: string; text: string }) {
  return {
    customId: input.customId,
    purpose: EMAIL_CLASSIFY_PURPOSE,
    system: SYSTEM_PROMPT,
    user: [
      "kind: email_classify",
      `subject: ${input.subject}`,
      `body: ${input.text.slice(0, CLASSIFY_TEXT_LIMIT)}`,
    ].join("\n"),
    schema: OUTPUT_SCHEMA,
  } satisfies LlmRequest;
}

export async function classifyWithLlm(
  deps: {
    db: AppDatabase;
    clock: Clock;
    llm: LlmPort;
    degraded?: DegradedFlagReader | undefined;
    spendGate?: SpendGate | undefined;
  },
  input: { userId: string; messageId: string; subject: string; text: string },
) {
  if (deps.degraded !== undefined && (await deps.degraded.isDegraded())) {
    logInfo("degraded", "email_classify skipped while degraded: rules only");

    return "other";
  }

  const spendGate = deps.spendGate ?? ungatedSpend;

  if (!spendGate.allows(input.userId)) {
    logInfo("spend", "email_classify skipped without Applications left: rules only");

    return "other";
  }

  const request = emailClassifyRequest({
    customId: `email-classify-${input.messageId}`,
    subject: input.subject,
    text: input.text,
  });

  const estimated = deps.llm.estimateBatchCostMicros([request]);

  const caps = checkLlmCaps(deps.db, deps.clock, {
    userId: input.userId,
    purpose: EMAIL_CLASSIFY_PURPOSE,
    estimatedCostMicros: estimated,
  });

  if (!caps.withinCaps) {
    raiseAlert(deps.db, deps.clock, "llm.cap", {
      cap: caps.exceeded,
      capMicros: caps.capMicros,
      estimatedMicros: estimated,
      purpose: EMAIL_CLASSIFY_PURPOSE,
      spentMicros: caps.spentMicros,
    });

    return "other";
  }

  const calls = await deps.llm.runBatch([request]);
  let classification: MailClassification = "other";

  for (const call of calls) {
    recordLlmUsage(deps.db, deps.clock, {
      batch:
        call.batchRecordId === undefined
          ? undefined
          : { customId: call.customId, recordId: call.batchRecordId },
      userId: input.userId,
      purpose: EMAIL_CLASSIFY_PURPOSE,
      model: call.model,
      inputTokens: call.inputTokens,
      cachedTokens: call.cachedTokens,
      outputTokens: call.outputTokens,
      costMicros: call.costMicros,
    });

    if (call.customId !== request.customId || !call.result.ok) {
      continue;
    }

    const parsed = outputSchema.safeParse(call.result.value);

    if (parsed.success) {
      const { classification: found } = parsed.data;

      classification = found;
    }
  }

  return classification;
}
