import { describe, expect, test } from "bun:test";

import type { FactRecord } from "../profile/facts.ts";

import { emptyTargets } from "../../shared/targets.ts";

import type { QuestionFieldType } from "../../shared/questions.ts";
import { indexFacts, resolveQuestion, withEmailAddress } from "./answer-plan.ts";
import { parseSalaryExpectation } from "./answer-value.ts";

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

function resolve(
  questionText: string,
  facts: readonly FactRecord[],
  fieldType: QuestionFieldType = "text",
) {
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

  test("keeps both ends of a range whose currency repeats", () => {
    expect(parseSalaryExpectation("£50,000 - £60,000 per annum")).toEqual({
      currency: "GBP",
      maxMinor: 6_000_000,
      minMinor: 5_000_000,
      period: "year",
    });

    expect(parseSalaryExpectation("$120,000 - $150,000")).toEqual({
      currency: null,
      maxMinor: 15_000_000,
      minMinor: 12_000_000,
      period: null,
    });

    expect(parseSalaryExpectation("CAD 90,000 to CAD 110,000 a year")).toEqual({
      currency: "CAD",
      maxMinor: 11_000_000,
      minMinor: 9_000_000,
      period: "year",
    });
  });

  test("does not put the lower bound of a range into a numeric field", () => {
    const ranged = [fact("salary_expectation", "£50,000 - £60,000 per annum", "GBP")];

    expect(resolve("Expected annual salary (GBP)", ranged, "number")).toMatchObject({
      kind: "blocked",
    });
  });
});

describe("the apply alias on a new application", () => {
  test("answers every email question from the alias instead of the stored fact", () => {
    const stored = indexFacts([fact("email", "maya@example.com")]);
    const facts = withEmailAddress(stored, "maya.okafor.4k@tryoverture.com");

    expect(
      resolveQuestion({
        answerKind: "fact",
        factKey: "email",
        facts,
        fieldType: "email",
        hasCoverLetter: false,
        hasResume: true,
        options: [],
        posting,
        questionText: "Email",
        required: true,
        targets: emptyTargets,
      }),
    ).toMatchObject({ kind: "answer", value: "maya.okafor.4k@tryoverture.com" });
  });

  test("leaves the stored fact and its revision in place", () => {
    const stored = indexFacts([fact("email", "maya@example.com")]);
    const facts = withEmailAddress(stored, "maya.okafor.4k@tryoverture.com");

    expect(stored.unscoped.get("email")).toBe("maya@example.com");
    expect(facts.revisions).toEqual(stored.revisions);
    expect(facts.details.get("email")).toMatchObject({ confirmed: true });
  });
});
