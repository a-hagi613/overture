import { describe, expect, test } from "bun:test";

import { openDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { createClock } from "../ports/clock.ts";
import { llmUsage } from "../db/schema.ts";

import { recordLlmUsage } from "./usage.ts";

function freshDatabase() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite, clock: createClock() };
}

const CALL = {
  cachedTokens: 0,
  costMicros: 120,
  inputTokens: 10,
  model: "claude-haiku-5-5",
  outputTokens: 5,
  purpose: "tag_fallback",
  userId: null,
};

describe("LLM usage recording", () => {
  test("records a call once when it names a durable batch, however often it runs", () => {
    const { db, sqlite, clock } = freshDatabase();

    try {
      const batch = { customId: "tag-fallback-0", recordId: "batch-record-1" };

      recordLlmUsage(db, clock, { ...CALL, batch });
      recordLlmUsage(db, clock, { ...CALL, batch });

      expect(db.select().from(llmUsage).all().length).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  test("records separate rows for the same batch when the call differs", () => {
    const { db, sqlite, clock } = freshDatabase();

    try {
      recordLlmUsage(db, clock, {
        ...CALL,
        batch: { customId: "tag-fallback-0", recordId: "batch-record-1" },
      });
      recordLlmUsage(db, clock, {
        ...CALL,
        batch: { customId: "tag-fallback-1", recordId: "batch-record-1" },
      });

      expect(db.select().from(llmUsage).all().length).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  test("records every call that names no batch", () => {
    const { db, sqlite, clock } = freshDatabase();

    try {
      recordLlmUsage(db, clock, CALL);
      recordLlmUsage(db, clock, CALL);

      expect(db.select().from(llmUsage).all().length).toBe(2);
    } finally {
      sqlite.close();
    }
  });
});
