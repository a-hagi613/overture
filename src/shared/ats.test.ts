import { describe, expect, test } from "bun:test";

import {
  APPLY_SUPPORTED_ATS,
  ATS_REGISTRY,
  ATS_VALUES,
  BATCH_1_ATS,
  BATCH_2_ATS,
  BATCH_3_ATS,
  BATCH_4_ATS,
  isApplySupportedAts,
  isBatch1Ats,
  isBatchFourAts,
  isWaveTwoAts,
  PLAN_CACHE_ATS,
  WAVE_2_ATS,
} from "./ats.ts";

describe("the ATS registry", () => {
  test("ships an apply adapter for every batch that has landed", () => {
    const batches = [BATCH_1_ATS, BATCH_2_ATS, BATCH_3_ATS, BATCH_4_ATS, WAVE_2_ATS];

    for (const ats of batches.flat()) {
      expect(ATS_REGISTRY[ats].applySupported).toBe(true);
      expect(isApplySupportedAts(ats)).toBe(true);
      expect(APPLY_SUPPORTED_ATS).toContain(ats);
      expect(PLAN_CACHE_ATS).toContain(ats);
    }

    expect(APPLY_SUPPORTED_ATS).toHaveLength(ATS_VALUES.length);
  });

  test("ships Batch 4's eight boards through the Batch 4 reader", () => {
    expect(BATCH_4_ATS).toEqual([
      "hiringthing",
      "rippling",
      "gem",
      "isolved_hire",
      "applicantpro",
      "catsone",
      "onlyfy",
      "varbi",
    ]);

    for (const ats of BATCH_4_ATS) {
      expect(isBatchFourAts(ats)).toBe(true);
      expect(isBatch1Ats(ats)).toBe(false);
    }
  });

  test("ships Wave 2's two boards through the Wave 2 readers", () => {
    expect(WAVE_2_ATS).toEqual(["jobvite", "herp"]);

    for (const ats of WAVE_2_ATS) {
      expect(isWaveTwoAts(ats)).toBe(true);
      expect(isBatchFourAts(ats)).toBe(false);
      expect(ATS_REGISTRY[ats].wave).toBe("wave2");
    }

    expect(isWaveTwoAts("workday")).toBe(false);
  });

  test("has one registry entry for every accepted ATS value", () => {
    expect(Object.keys(ATS_REGISTRY).toSorted()).toEqual([...ATS_VALUES].toSorted());
  });

  test("does not treat an unknown board as apply-supported", () => {
    expect(isApplySupportedAts("workday")).toBe(false);
    expect(isBatchFourAts("workday")).toBe(false);
  });
});
