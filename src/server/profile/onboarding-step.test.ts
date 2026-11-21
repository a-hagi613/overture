import { describe, expect, test } from "bun:test";

import type { FactRecord } from "./facts.ts";

import {
  currenciesFor,
  eeoAnswersFrom,
  homeCountryCode,
  salaryAnswersFrom,
  salaryFactValue,
} from "./onboarding-step.ts";

function fact(key: string, value: string, scope = "") {
  return { confirmed: true, key, revision: 1, scope, source: "user", value } satisfies FactRecord;
}

describe("a salary answer becomes the Fact the planner reads", () => {
  test("keeps the currency, the amount and the period in the value", () => {
    expect(salaryFactValue({ amount: "140,000", currency: "CAD", period: "a year" })).toBe(
      "CAD 140,000 a year",
    );

    expect(salaryFactValue({ amount: "95 000", currency: "USD", period: "a year" })).toBe(
      "USD 95,000 a year",
    );
  });

  test("refuses an amount that is not a number", () => {
    expect(salaryFactValue({ amount: "", currency: "CAD", period: "a year" })).toBeNull();

    expect(salaryFactValue({ amount: "about 140k", currency: "CAD", period: "a year" })).toBeNull();

    expect(salaryFactValue({ amount: "140,000", currency: "CAD", period: "" })).toBeNull();
  });
});

describe("reading saved salary Facts back into rows", () => {
  test("returns one row per currency with the amount formatted and the period worded", () => {
    const rows = salaryAnswersFrom([
      fact("salary_expectation", "CAD 140,000 a year", "CAD"),
      fact("salary_expectation", "USD 62 an hour", "USD"),
      fact("current_job_title", "Platform Engineer"),
    ]);

    expect(rows).toEqual([
      { amount: "140,000", currency: "CAD", period: "a year" },
      { amount: "62", currency: "USD", period: "an hour" },
    ]);
  });

  test("shows no period for a Fact saved without one, rather than assuming a year", () => {
    expect(salaryAnswersFrom([fact("salary_expectation", "CAD 140,000", "CAD")])).toEqual([
      { amount: "140,000", currency: "CAD", period: "" },
    ]);
  });

  test("ignores an unscoped salary Fact, which is not one currency's answer", () => {
    expect(salaryAnswersFrom([fact("salary_expectation", "CAD 140,000 a year")])).toEqual([]);
  });
});

describe("reading the EEO answers", () => {
  test("is off, with every field at Prefer not to say, until an answer is saved", () => {
    expect(eeoAnswersFrom([])).toEqual({
      disability: "Prefer not to say",
      enabled: false,
      ethnicity: "Prefer not to say",
      gender: "Prefer not to say",
      veteran: "Prefer not to say",
    });
  });

  test("is on as soon as one EEO Fact is saved", () => {
    expect(eeoAnswersFrom([fact("eeo_gender", "Non-binary")])).toEqual({
      disability: "Prefer not to say",
      enabled: true,
      ethnicity: "Prefer not to say",
      gender: "Non-binary",
      veteran: "Prefer not to say",
    });
  });
});

describe("choosing the currencies the Facts step offers", () => {
  test("uses the Target currency and nothing else when a saved location would add a second", () => {
    expect(
      currenciesFor({
        countryCodes: ["GB"],
        inferCountries: true,
        queued: [],
        salaryCurrencies: [],
        targetCurrency: "CAD",
      }),
    ).toEqual(["CAD"]);
  });

  test("guesses from the country only when no queued, saved or Target currency exists", () => {
    expect(
      currenciesFor({
        countryCodes: ["GB"],
        inferCountries: true,
        queued: [],
        salaryCurrencies: [],
        targetCurrency: null,
      }),
    ).toEqual(["GBP"]);
  });

  test("keeps queued currencies ahead of the Target currency without adding the country guess", () => {
    expect(
      currenciesFor({
        countryCodes: ["GB"],
        inferCountries: true,
        queued: ["USD"],
        salaryCurrencies: [],
        targetCurrency: "CAD",
      }),
    ).toEqual(["USD", "CAD"]);
  });

  test("keeps saved salary currencies and adds a distinct Target currency", () => {
    expect(
      currenciesFor({
        countryCodes: ["GB"],
        inferCountries: true,
        queued: [],
        salaryCurrencies: ["EUR"],
        targetCurrency: "CAD",
      }),
    ).toEqual(["EUR", "CAD"]);
  });

  test("infers nothing when inference is off and no answer exists", () => {
    expect(
      currenciesFor({
        countryCodes: ["GB"],
        inferCountries: false,
        queued: [],
        salaryCurrencies: [],
        targetCurrency: null,
      }),
    ).toEqual([]);
  });
});

describe("reading the home country", () => {
  test("resolves a two-letter code, a country name and a city", () => {
    expect(homeCountryCode([fact("current_country", "CA")])).toBe("CA");
    expect(homeCountryCode([fact("current_country", "Canada")])).toBe("CA");
    expect(homeCountryCode([fact("current_country", "London")])).toBe("GB");
  });

  test("is undefined when the Fact is missing or blank", () => {
    expect(homeCountryCode([])).toBeNull();
    expect(homeCountryCode([fact("current_country", "   ")])).toBeNull();
  });
});
