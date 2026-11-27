import { describe, expect, test } from "bun:test";

import {
  SCORE_OUTPUT_SCHEMA,
  SCORE_SCORER_VERSION,
  SCORE_SYSTEM_PROMPT,
  scoreCandidatePrefix,
  scoreRequestFor,
} from "./prompts/score-v1.ts";
import { parseScoreReply, scoreOf } from "./score-schema.ts";
import type { ScoreReply } from "./score-schema.ts";

const valid: ScoreReply = {
  blockers: [],
  level: 20,
  logistics: 10,
  reasons: ["Same Go backend work as your last role.", "The posting asks for five years."],
  role_fit: 40,
  skills: 30,
};

describe("the score reply schema", () => {
  test("accepts an exact anchored reply and sums the four sub-scores", () => {
    const parsed = parseScoreReply(JSON.stringify(valid));

    expect(parsed).toEqual(valid);
    expect(parsed === null ? null : scoreOf(parsed)).toBe(100);
  });

  test("rejects a value outside an anchor, free text, a single reason and an over-long reason", () => {
    expect(parseScoreReply(JSON.stringify({ ...valid, role_fit: 20 }))).toBeNull();
    expect(parseScoreReply("A strong fit overall.")).toBeNull();
    expect(parseScoreReply(JSON.stringify({ ...valid, reasons: [valid.reasons[0]] }))).toBeNull();
    expect(
      parseScoreReply(JSON.stringify({ ...valid, reasons: ["x".repeat(111), valid.reasons[1]] })),
    ).toBeNull();
    expect(parseScoreReply(null)).toBeNull();
  });

  test("rejects an unknown blocker value", () => {
    expect(parseScoreReply(JSON.stringify({ ...valid, blockers: ["salary_too_low"] }))).toBeNull();
  });

  test("sums the four anchors and never trusts an overall score from the model", () => {
    expect(scoreOf({ level: 12, logistics: 5, role_fit: 30, skills: 20 })).toBe(67);
    expect(SCORE_OUTPUT_SCHEMA.required).toEqual([
      "role_fit",
      "skills",
      "level",
      "logistics",
      "blockers",
      "reasons",
    ]);
  });

  test("sends a wire schema structured outputs accepts and keeps the reason count in zod", () => {
    const { reasons } = SCORE_OUTPUT_SCHEMA.properties;

    expect("minItems" in reasons).toBe(false);
    expect("maxItems" in reasons).toBe(false);
    expect(
      parseScoreReply(
        JSON.stringify({
          ...valid,
          reasons: [...valid.reasons, "A third reason.", "A fourth reason."],
        }),
      ),
    ).toBeNull();
  });
});

describe("the v1 prompt", () => {
  test("carries the exact anchors, blockers and two worked examples", () => {
    expect(SCORE_SCORER_VERSION).toBe("score-v1");
    expect(SCORE_SYSTEM_PROMPT).toContain("role_fit (0/15/30/40)");
    expect(SCORE_SYSTEM_PROMPT).toContain("skills (0/10/20/30)");
    expect(SCORE_SYSTEM_PROMPT).toContain("level (0/4/12/20)");
    expect(SCORE_SYSTEM_PROMPT).toContain("logistics (0/5/10)");
    expect(SCORE_SYSTEM_PROMPT).toContain("A missing skill or technology is never a blocker");
    expect(SCORE_SYSTEM_PROMPT.match(/^Example [12]$/gmu)).toHaveLength(2);
  });

  test("sends only the array bounds Anthropic structured output accepts", () => {
    const reasons = SCORE_OUTPUT_SCHEMA.properties.reasons;

    expect(Object.hasOwn(reasons, "minItems")).toBe(false);
    expect(Object.hasOwn(reasons, "maxItems")).toBe(false);
    expect(
      parseScoreReply(JSON.stringify({ ...valid, reasons: ["one", "two", "three", "four"] })),
    ).toBeNull();
  });

  test("puts the candidate resume and targets before the job so caching covers them", () => {
    const candidate = { resume: "Five years of Go.", targets: "roles: Backend" };
    const prefix = scoreCandidatePrefix(candidate);

    const request = scoreRequestFor({
      candidate,
      customId: "score-job-1",
      job: {
        company: "Acme",
        description: "Build Go services.",
        location: "Toronto",
        title: "Backend Engineer",
      },
    });

    expect(prefix.indexOf("CANDIDATE RESUME")).toBeLessThan(prefix.indexOf("CANDIDATE TARGETS"));
    expect(request.cachePrefix).toBe(prefix);
    expect(request.user.startsWith("JOB:")).toBe(true);
    expect(request.purpose).toBe("score");
    expect(request.schema).toBe(SCORE_OUTPUT_SCHEMA);
  });
});
