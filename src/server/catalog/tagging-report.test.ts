import { describe, expect, test } from "bun:test";

import { readPublishedTagging } from "./tagging-report.ts";

const KEY = "catalog/latest.json";

function storeOf(text: string | null) {
  return {
    get: async () => {
      const encoded = text === null ? null : new TextEncoder().encode(text);

      return await Promise.resolve(encoded);
    },
  };
}

const REPORT = {
  total_postings: 849_612,
  cross_board_dupes_removed: 41_002,
  unique_title_dept_pairs: 312_004,
  cache_hit: 210_100,
  tier1_esco_rules: 80_000,
  tier2_embeddings: 18_500,
  tier3_haiku_batch_sent: 412,
  tier3_haiku_resolved: 3402,
  still_untagged: 12_004,
  input_tokens: 5_200_000,
  output_tokens: 310_000,
  tier3_cost_usd: 6.71,
} as const;

describe("readPublishedTagging", () => {
  test("reads the version and report out of the published manifest", async () => {
    const result = await readPublishedTagging({
      key: KEY,
      objects: storeOf(JSON.stringify({ version: "2026-11-24", tagging: REPORT })),
    });

    expect(result).toEqual({ manifestVersion: "2026-11-24", tagging: REPORT });
  });

  test("answers nulls for a missing manifest, malformed JSON or a legacy manifest without a report", async () => {
    const missing = await readPublishedTagging({ key: KEY, objects: storeOf(null) });
    const malformed = await readPublishedTagging({ key: KEY, objects: storeOf("{not json") });

    const legacy = await readPublishedTagging({
      key: KEY,
      objects: storeOf(JSON.stringify({ version: "2026-10-01" })),
    });

    const unknownField = await readPublishedTagging({
      key: KEY,
      objects: storeOf(JSON.stringify({ version: "2026-11-01", tagging: { total_postings: 3 } })),
    });

    expect(missing).toEqual({ manifestVersion: null, tagging: null });
    expect(malformed).toEqual({ manifestVersion: null, tagging: null });
    expect(legacy).toEqual({ manifestVersion: "2026-10-01", tagging: null });
    expect(unknownField).toEqual({ manifestVersion: null, tagging: null });
  });

  test("answers nulls when the object store itself fails", async () => {
    const result = await readPublishedTagging({
      key: KEY,
      objects: {
        get: async () => {
          await Promise.resolve();

          throw new Error("R2 is down");
        },
      },
    });

    expect(result).toEqual({ manifestVersion: null, tagging: null });
  });
});
