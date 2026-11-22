import { describe, expect, test } from "bun:test";

import { openDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { createClock } from "../ports/clock.ts";

import {
  applyLlmBatchResultsOnce,
  createLlmBatchRow,
  failLlmBatch,
  findLlmBatch,
  reopenLlmBatch,
} from "./batch-store.ts";

function freshStore() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { clock: createClock(), db, sqlite };
}

describe("createLlmBatchRow", () => {
  test("returns the recorded batch when the same request set is recorded twice", () => {
    const { clock, db } = freshStore();

    const first = createLlmBatchRow(db, clock, {
      id: "batch-record-1",
      inputRevisionHash: "revision-1",
      model: "claude-haiku-5-5",
    });

    const second = createLlmBatchRow(db, clock, {
      id: "batch-record-2",
      inputRevisionHash: "revision-1",
      model: "claude-haiku-5-5",
    });

    expect(second.record.id).toBe(first.record.id);
    expect(second.owned).toBe(false);
    expect(findLlmBatch(db, "batch-record-2")).toBeUndefined();
  });
});

describe("applyLlmBatchResultsOnce", () => {
  test("claims the results once and returns the stored results to every later caller", () => {
    const { clock, db } = freshStore();

    createLlmBatchRow(db, clock, {
      id: "batch-record-1",
      inputRevisionHash: "revision-1",
      model: "claude-haiku-5-5",
    });

    const first = applyLlmBatchResultsOnce(db, clock, "batch-record-1", "[]");
    const second = applyLlmBatchResultsOnce(db, clock, "batch-record-1", "[]");

    expect(first).toBe(true);
    expect(second).toBe(false);

    const record = findLlmBatch(db, "batch-record-1");

    expect(record?.status).toBe("applied");
    expect(record?.resultAppliedAt).not.toBeNull();
  });
});

describe("reopenLlmBatch", () => {
  test("reopens a failed record so the next run submits it again", () => {
    const { clock, db } = freshStore();

    createLlmBatchRow(db, clock, {
      id: "batch-record-1",
      inputRevisionHash: "revision-1",
      model: "claude-haiku-5-5",
    });
    failLlmBatch(db, clock, "batch-record-1", "the provider lost the batch");

    expect(reopenLlmBatch(db, clock, "batch-record-1")).toBe(true);

    const record = findLlmBatch(db, "batch-record-1");

    expect(record?.status).toBe("creating");
    expect(record?.lastError).toBeNull();
    expect(reopenLlmBatch(db, clock, "batch-record-1")).toBe(false);
  });
});
