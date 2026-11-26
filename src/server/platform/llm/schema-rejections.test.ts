import { expect, test } from "bun:test";

import { openCountingDatabase } from "../../testing/query-counter.ts";
import { events } from "../db/schema.ts";
import { LLM_SCHEMA_REJECTION_TOPIC, recordLlmSchemaRejection } from "./schema-rejections.ts";

test("a rejected AI answer records its model and purpose as a countable event", () => {
  const { db } = openCountingDatabase();
  const at = 1_795_000_000_000;
  const clock = { now: () => at };

  recordLlmSchemaRejection(db, clock, { model: "claude-haiku-5.5", purpose: "score" });

  const [row] = db.select().from(events).all();

  expect(row).toMatchObject({
    createdAt: at,
    topic: LLM_SCHEMA_REJECTION_TOPIC,
  });
  expect(JSON.parse(row?.payload ?? "{}")).toEqual({
    model: "claude-haiku-5.5",
    purpose: "score",
  });
});
