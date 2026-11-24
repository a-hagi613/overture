import { describe, expect, test } from "bun:test";

import { annualUsdFromMinor, salaryUsdUpdateSql } from "./salary-usd.ts";

describe("annualUsdFromMinor", () => {
  test("keeps a yearly USD range unchanged", () => {
    expect(annualUsdFromMinor(15_000_000, "USD", "year")).toBe(150_000);
  });

  test("annualizes a monthly amount", () => {
    expect(annualUsdFromMinor(1_000_000, "USD", "month")).toBe(120_000);
  });

  test("annualizes an hourly amount", () => {
    expect(annualUsdFromMinor(5000, "USD", "hour")).toBe(104_000);
  });

  test("converts a foreign yearly amount to USD", () => {
    expect(annualUsdFromMinor(10_000_000, "EUR", "year")).toBe(108_000);
  });

  test("an unknown currency stays null instead of guessing", () => {
    expect(annualUsdFromMinor(1_000_000, "XYZ", "year")).toBeNull();
    expect(annualUsdFromMinor(null, "USD", "year")).toBeNull();
  });
});

describe("salaryUsdUpdateSql", () => {
  test("updates both normalized columns in one statement", () => {
    const statement = salaryUsdUpdateSql();

    expect(statement).toContain("salary_min_usd");
    expect(statement).toContain("salary_max_usd");
    expect(statement).toContain("upper(coalesce(salary_currency");
  });
});
