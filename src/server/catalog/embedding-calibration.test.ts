import { describe, expect, test } from "bun:test";

import type { ScoredExample } from "./embedding-calibration.ts";

import { evaluateCalibration, suggestThresholds } from "./embedding-calibration.ts";

function example(overrides: Partial<ScoredExample> & Pick<ScoredExample, "title">) {
  return {
    category: "Software Engineering",
    language: "en",
    margin: 0.2,
    role: "Software Engineer",
    top1Category: "Software Engineering",
    top1Role: "Software Engineer",
    top1Score: 0.9,
    ...overrides,
  } satisfies ScoredExample;
}

describe("embedding calibration", () => {
  test("counts only accepted examples in precision and coverage", () => {
    const examples = [
      example({ title: "kept" }),
      example({ title: "not-confident", top1Score: 0.7 }),
      example({
        title: "wrong",
        top1Category: "Marketing",
        top1Role: "Copywriter",
      }),
    ];

    const result = evaluateCalibration(examples, 0.78, 0.06);

    expect(result.accepted).toBe(2);
    expect(result.correct).toBe(1);
    expect(result.precision).toBeCloseTo(0.5);
    expect(result.coverage).toBeCloseTo(2 / 3);
    expect(result.accuracy).toBeCloseTo(2 / 3);
  });

  test("suggests the highest-precision pair that keeps the requested coverage", () => {
    const examples = [
      example({ title: "correct-1" }),
      example({ title: "correct-2" }),
      example({
        title: "wrong-but-marginal",
        margin: 0.02,
        top1Category: "Marketing",
        top1Role: "Copywriter",
        top1Score: 0.8,
      }),
    ];

    const suggested = suggestThresholds(examples, 0.6);

    expect(suggested.precision).toBe(1);
    expect(suggested.acceptMargin).toBeGreaterThanOrEqual(0.03);
    expect(suggested.coverage).toBeGreaterThanOrEqual(0.6);
  });
});
