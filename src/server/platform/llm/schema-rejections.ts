import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { events } from "../db/schema.ts";

/** The `events` topic the alert collector counts for the Haiku rejection-rate alert. */
export const LLM_SCHEMA_REJECTION_TOPIC = "llm.schema_rejection";

/**
 * Records one AI answer that failed its zod schema. The collector compares
 * these rows with the `llm_usage` calls in the same window, so a rising Haiku
 * rejection rate surfaces without storing the rejected free text.
 * @param db The application database the event is written to.
 * @param clock The clock that stamps the rejection.
 * @param input The model and purpose whose answer was rejected.
 */
export function recordLlmSchemaRejection(
  db: AppDatabase,
  clock: Clock,
  input: { purpose: string; model: string },
) {
  db.insert(events)
    .values({
      createdAt: clock.now(),
      payload: JSON.stringify({ model: input.model, purpose: input.purpose }),
      topic: LLM_SCHEMA_REJECTION_TOPIC,
      userId: null,
    })
    .run();
}
