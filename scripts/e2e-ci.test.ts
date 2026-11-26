import { expect, test } from "bun:test";

import { computePlan, hasHighRiskLabel, parseLabels } from "./e2e-ci.ts";

const map = {
  version: 1 as const,
  tests: {
    "test/e2e/home.test.ts": {
      full: false,
      paths: ["/"],
      routes: [],
      designs: [],
      modules: ["src/web/home.tsx"],
    },
    "test/e2e/inbox.test.ts": {
      full: false,
      paths: ["/inbox"],
      routes: [],
      designs: [],
      modules: ["src/web/inbox.tsx"],
    },
  },
};

const allTests = ["test/e2e/home.test.ts", "test/e2e/inbox.test.ts"];

const seconds = { "test/e2e/home.test.ts": 30, "test/e2e/inbox.test.ts": 30 };

test("parseLabels trims, lowercases and drops empty label names", () => {
  expect(parseLabels(" high-risk, Do-Not-Auto-Merge ,, enhancement ")).toStrictEqual([
    "high-risk",
    "do-not-auto-merge",
    "enhancement",
  ]);
});

test("hasHighRiskLabel finds the high-risk label by its exact name", () => {
  expect(hasHighRiskLabel(parseLabels("bug,high-risk"))).toBe(true);
  expect(hasHighRiskLabel(parseLabels("enhancement,do-not-auto-merge"))).toBe(false);
  expect(hasHighRiskLabel(parseLabels("high-risk-ui"))).toBe(false);
});

test("a PR without high-risk keeps the changed-area e2e shards", () => {
  const plan = computePlan({
    changed: ["src/web/home.tsx"],
    isMain: false,
    map,
    seconds,
    allTests,
  });

  expect(plan.full).toBe(false);
  expect(plan.selected).toStrictEqual(["test/e2e/home.test.ts"]);
});

test("a PR labelled high-risk runs the full e2e suite", () => {
  const plan = computePlan({
    changed: ["src/web/home.tsx"],
    full: hasHighRiskLabel(parseLabels("high-risk")),
    isMain: false,
    map,
    seconds,
    allTests,
  });

  expect(plan.full).toBe(true);
  expect(plan.selected).toStrictEqual(allTests);
  expect(plan.shards.flatMap((shard) => shard.files)).toStrictEqual(allTests);
  expect(plan.reason).toBe("the high-risk label runs the full suite");
});
