import { describe, expect, test } from "bun:test";

import fixture from "./fixtures/eval-686/king-kong-2026-11-27.json";

describe("the #686 eval fixture", () => {
  test("keeps the gate's shape: 20–40 unique recorded jobs and at least two repeats", () => {
    const ids = fixture.jobs.map((job) => job.id);

    expect(fixture.repeats).toBe(2);
    expect(fixture.jobs.length).toBeGreaterThanOrEqual(20);
    expect(fixture.jobs.length).toBeLessThanOrEqual(40);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fixture.jobs.filter((job) => job.expectedWrongField).length).toBeGreaterThan(0);
  });

  test("sends the first 220 words of each posting, as production does", () => {
    for (const job of fixture.jobs) {
      expect(job.title.trim()).not.toBe("");
      expect(job.company.trim()).not.toBe("");
      expect(job.description.trim()).not.toBe("");
      expect(job.description.split(/\s+/u).length).toBeLessThanOrEqual(220);
    }
  });

  test("describes the King Kong stand-in's targets", () => {
    expect(fixture.resume).toContain("five years");
    expect(fixture.targets).toContain("Backend");
    expect(fixture.targets).toContain("Full-Stack");
    expect(fixture.targets).toContain("Toronto");
    expect(fixture.targets).toContain("Remote · Canada");
  });
});
