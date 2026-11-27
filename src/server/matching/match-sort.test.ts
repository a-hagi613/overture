import { describe, expect, test } from "bun:test";

import type { SortableMatch } from "./match-sort.ts";

import {
  matchBandOf,
  matchIsVisible,
  matchPage,
  orderedMatches,
  orderedMatchesWithPending,
  topPicksByEmployer,
} from "./match-sort.ts";

function match(overrides: Partial<SortableMatch> & { id: string; codeRank?: number }) {
  return {
    blockers: [],
    codeRank: 0,
    companyKey: "acme",
    exactRole: false,
    postedAt: 1000,
    score: 70,
    ...overrides,
  } satisfies SortableMatch & { codeRank: number };
}

describe("the match band", () => {
  test("maps the score to the three bands and hides below the floor", () => {
    expect(matchBandOf(100)).toBe("Strong");
    expect(matchBandOf(85)).toBe("Strong");
    expect(matchBandOf(84)).toBe("Good");
    expect(matchBandOf(70)).toBe("Good");
    expect(matchBandOf(69)).toBe("Possible");
    expect(matchBandOf(50)).toBe("Possible");
    expect(matchBandOf(49)).toBeNull();
  });

  test("never shows a blocked or low-scoring job, even with a high arithmetic score", () => {
    expect(matchIsVisible({ blockers: [], score: 95 })).toBe(true);
    expect(matchIsVisible({ blockers: ["license_required"], score: 95 })).toBe(false);
    expect(matchIsVisible({ blockers: [], score: 49 })).toBe(false);
    expect(matchIsVisible({ blockers: [], score: null })).toBe(false);
  });
});

describe("the match order", () => {
  test("puts a stronger band first even when a lower-band job has a higher raw score", () => {
    const ordered = orderedMatches([
      match({ id: "possible-69", score: 69 }),
      match({ id: "strong-85", score: 85 }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["strong-85", "possible-69"]);
  });

  test("puts an exact target role before a category-only match inside a band", () => {
    const ordered = orderedMatches([
      match({ id: "category", exactRole: false, score: 90 }),
      match({ id: "exact", exactRole: true, score: 86 }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["exact", "category"]);
  });

  test("orders by score, then newest posting, then posting id", () => {
    const ordered = orderedMatches([
      match({ id: "b", postedAt: 1000, score: 90 }),
      match({ id: "a", postedAt: 1000, score: 90 }),
      match({ id: "newest", postedAt: 2000, score: 90 }),
      match({ id: "lower", postedAt: 3000, score: 88 }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["newest", "a", "b", "lower"]);
  });

  test("keeps the same order across calls", () => {
    const rows = [
      match({ id: "c", companyKey: "c", score: 71 }),
      match({ id: "a", companyKey: "a", score: 71 }),
      match({ id: "b", companyKey: "b", score: 71 }),
    ];

    const first = orderedMatches(rows).map((row) => row.id);
    const second = orderedMatches([...rows].toReversed()).map((row) => row.id);

    expect(first).toEqual(second);
  });

  test("hides blocked and low jobs from the list entirely", () => {
    const ordered = orderedMatches([
      match({ id: "shown", score: 80 }),
      match({ id: "blocked", blockers: ["not_a_job"], score: 95 }),
      match({ id: "low", score: 40 }),
      match({ id: "scoring", score: null }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["shown"]);
  });
});

describe("the match page", () => {
  test("pages without repeating or skipping a posting", () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      match({ id: `job-${String(index)}`, score: 90 - index }),
    );

    const first = matchPage(rows, 0, 3);
    const second = matchPage(rows, 3, 3);
    const third = matchPage(rows, 6, 3);
    const ids = [...first.items, ...second.items, ...third.items].map((row) => row.id);

    expect(first.total).toBe(7);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toEqual(["job-0", "job-1", "job-2", "job-3", "job-4", "job-5", "job-6"]);
  });
});

describe("the whole list including rows still scoring", () => {
  test("keeps every scored row above a row that has no stored score yet", () => {
    const ordered = orderedMatchesWithPending([
      match({ codeRank: 99, id: "scoring", score: null }),
      match({ codeRank: 10, id: "scored", score: 60 }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["scored", "scoring"]);
  });

  test("orders the rows still scoring by code rank, then newest posting, then id", () => {
    const ordered = orderedMatchesWithPending([
      match({ codeRank: 10, id: "b", postedAt: 1000, score: null }),
      match({ codeRank: 10, id: "newest", postedAt: 2000, score: null }),
      match({ codeRank: 10, id: "a", postedAt: 1000, score: null }),
      match({ codeRank: 20, id: "ranker", postedAt: 500, score: null }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["ranker", "newest", "a", "b"]);
  });

  test("never shows a blocked or low-scoring row, scored or not", () => {
    const ordered = orderedMatchesWithPending([
      match({ codeRank: 1, id: "blocked", blockers: ["not_a_job"], score: 90 }),
      match({ codeRank: 1, id: "low", score: 40 }),
      match({ codeRank: 1, id: "shown", score: 80 }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["shown"]);
  });
});

describe("onboarding's picks", () => {
  test("takes the first job from each new employer until the limit", () => {
    const picks = topPicksByEmployer(
      [
        match({ companyKey: "acme", id: "acme-1", score: 95 }),
        match({ companyKey: "acme", id: "acme-2", score: 94 }),
        match({ companyKey: "northwind", id: "north-1", score: 90 }),
        match({ companyKey: "cedar", id: "cedar-1", score: 88 }),
        match({ companyKey: "birch", id: "birch-1", score: 87 }),
      ],
      3,
    );

    expect(picks.map((row) => row.id)).toEqual(["acme-1", "north-1", "cedar-1"]);
  });

  test("returns fewer than the limit when every job is one employer", () => {
    const picks = topPicksByEmployer(
      [match({ id: "one", score: 90 }), match({ id: "two", score: 89 })],
      3,
    );

    expect(picks.map((row) => row.id)).toEqual(["one"]);
  });
});
