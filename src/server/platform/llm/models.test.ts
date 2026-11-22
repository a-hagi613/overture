import { describe, expect, test } from "bun:test";

import { batchPricesFor, DEFAULT_ANTHROPIC_MODEL } from "./models.ts";

const HAIKU_5_5_BATCH = {
  inputPerMillionTokens: 50_000,
  cacheReadPerMillionTokens: 5000,
  cacheWritePerMillionTokens: 62_500,
  outputPerMillionTokens: 250_000,
};

const HAIKU_4_5_BATCH = {
  inputPerMillionTokens: 500_000,
  cacheReadPerMillionTokens: 50_000,
  cacheWritePerMillionTokens: 625_000,
  outputPerMillionTokens: 2_500_000,
};

describe("DEFAULT_ANTHROPIC_MODEL", () => {
  test("is the model SPEC §8.6 names and its batch prices are the 5.5 row", () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-haiku-5-5");
    expect(batchPricesFor(DEFAULT_ANTHROPIC_MODEL)).toEqual(HAIKU_5_5_BATCH);
  });
});

describe("batchPricesFor", () => {
  test("prices a 5.5 model from its exact row, not the shorter haiku prefix listed first", () => {
    expect(batchPricesFor("claude-haiku-5-5")).toEqual(HAIKU_5_5_BATCH);
    expect(batchPricesFor("claude-haiku-5-5-20260514")).toEqual(HAIKU_5_5_BATCH);
  });

  test("prices a 4.5 model from the haiku fallback prefix", () => {
    expect(batchPricesFor("claude-haiku-4-5")).toEqual(HAIKU_4_5_BATCH);
    expect(batchPricesFor("claude-haiku-4-5-20251001")).toEqual(HAIKU_4_5_BATCH);
  });

  test("keeps the sonnet and opus prefixes", () => {
    expect(batchPricesFor("claude-sonnet-4-5").inputPerMillionTokens).toBe(1_500_000);
    expect(batchPricesFor("claude-opus-4-5").outputPerMillionTokens).toBe(12_500_000);
  });

  test("refuses a model it has no price for instead of guessing", () => {
    expect(() => batchPricesFor("gpt-5")).toThrow("no batch pricing is known for model gpt-5");
  });
});
