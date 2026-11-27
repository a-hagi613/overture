import { describe, expect, test } from "bun:test";

import { gatePasses, repeatDifference, wrongFieldRate } from "./eval-gate.ts";

describe("the launch gate", () => {
  test("measures the average and maximum change between repeated scores", () => {
    const result = repeatDifference([
      { jobId: "a", scores: [80, 84, 79] },
      { jobId: "b", scores: [60, 75] },
    ]);

    expect(result.pairs).toBe(3);
    expect(result.average).toBeCloseTo(24 / 3);
    expect(result.max).toBe(15);
  });

  test("does not count a job scored once", () => {
    expect(repeatDifference([{ jobId: "a", scores: [80] }])).toEqual({
      average: 0,
      max: 0,
      pairs: 0,
    });
  });

  test("counts only labelled wrong-field jobs that still reached the visible list", () => {
    expect(
      wrongFieldRate([
        { expectedWrongField: true, visible: true },
        { expectedWrongField: true, visible: false },
        { expectedWrongField: false, visible: true },
      ]),
    ).toBe(0.5);
    expect(wrongFieldRate([{ expectedWrongField: false, visible: true }])).toBe(0);
  });

  test("passes only when both numeric bars hold", () => {
    expect(gatePasses({ average: 5, max: 15, pairs: 4 }, 0.02)).toBe(true);
    expect(gatePasses({ average: 5.1, max: 15, pairs: 4 }, 0)).toBe(false);
    expect(gatePasses({ average: 4, max: 16, pairs: 4 }, 0)).toBe(false);
    expect(gatePasses({ average: 4, max: 10, pairs: 4 }, 0.03)).toBe(false);
  });
});
