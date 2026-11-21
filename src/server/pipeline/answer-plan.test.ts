import { describe, expect, test } from "bun:test";

import type { FactRecord } from "../profile/facts.ts";

import { emptyTargets } from "../../shared/targets.ts";
import { indexFacts, resolveQuestion } from "./answer-plan.ts";

const posting = {
  city: "Toronto",
  companyName: "Northwind Labs",
  countryCode: "CA",
  locationRaw: "Toronto, Ontario, Canada",
  region: "Ontario",
};

function fact(key: string, value: string, scope = "") {
  return { confirmed: true, key, revision: 1, scope, source: "user", value } satisfies FactRecord;
}

function resolve(questionText: string, facts: readonly FactRecord[], fieldType = "text" as const) {
  return resolveQuestion({
    answerKind: "fact",
    factKey: "salary_expectation",
    facts: indexFacts(facts),
    fieldType,
    hasCoverLetter: false,
    hasResume: true,
    options: [],
    posting,
    questionText,
    required: true,
    targets: emptyTargets,
  });
}

describe("a salary Fact kept once per currency", () => {
  const facts = [
    fact("salary_expectation", "CAD 140,000 a year", "CAD"),
    fact("salary_expectation", "USD 95,000 a year", "USD"),
  ];

  test("answers a question that names the currency from that currency's Fact", () => {
    expect(resolve("What is your expected salary in USD?", facts)).toMatchObject({
      kind: "answer",
      scope: "USD",
      value: "USD 95,000 a year",
    });

    expect(resolve("Expected annual salary (CAD)", facts)).toMatchObject({
      kind: "answer",
      scope: "CAD",
      value: "CAD 140,000 a year",
    });
  });

  test("never answers a currency it has no Fact for", () => {
    expect(resolve("What is your expected salary in GBP?", facts)).toMatchObject({
      kind: "blocked",
      reason: "missing_fact",
    });
  });

  test("never picks a currency for a question that names none", () => {
    expect(resolve("What is your salary expectation?", facts)).toMatchObject({
      kind: "blocked",
      reason: "missing_fact",
    });
  });

  test("still answers from a single unscoped Fact when the currency agrees", () => {
    const unscoped = [fact("salary_expectation", "CAD 140,000 a year")];

    expect(resolve("What is your expected salary in CAD?", unscoped)).toMatchObject({
      kind: "answer",
      value: "CAD 140,000 a year",
    });
  });
});
