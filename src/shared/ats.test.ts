import { describe, expect, test } from "bun:test";

import {
  APPLY_SUPPORTED_ATS,
  ATS_REGISTRY,
  BATCH_1_ATS,
  isApplySupportedAts,
  isBatch1Ats,
} from "./ats.ts";

describe("the ATS registry", () => {
  test("Batch 1's five boards are apply-supported without touching another wave's boards", () => {
    expect(BATCH_1_ATS).toEqual([
      "smartrecruiters",
      "paylocity",
      "manatal",
      "careerplug",
      "jazzhr",
    ]);

    for (const ats of BATCH_1_ATS) {
      expect(ATS_REGISTRY[ats].applySupported).toBe(true);
      expect(isApplySupportedAts(ats)).toBe(true);
      expect(isBatch1Ats(ats)).toBe(true);
    }

    expect(APPLY_SUPPORTED_ATS).toHaveLength(20);
  });

  test("every other registry board stays ingest-only", () => {
    const unsupported = Object.entries(ATS_REGISTRY).filter(([, entry]) => !entry.applySupported);

    expect(unsupported).toHaveLength(8);

    for (const [ats] of unsupported) {
      expect(isApplySupportedAts(ats)).toBe(false);
      expect(isBatch1Ats(ats)).toBe(false);
    }
  });
});
