import { describe, expect, test } from "bun:test";

import { searchQuerySchema } from "./api.ts";

describe("searchQuerySchema role filters", () => {
  test("accepts a freehire category id, a role-taxonomy category and a granular role", () => {
    expect(
      searchQuerySchema.parse({ category: "software_engineering", q: "engineer" }).category,
    ).toBe("software_engineering");
    expect(searchQuerySchema.parse({ category: "software-it", q: "engineer" }).category).toBe(
      "software-it",
    );
    expect(searchQuerySchema.parse({ category: "Software & IT", q: "engineer" }).category).toBe(
      "Software & IT",
    );
    expect(
      searchQuerySchema.parse({ granularRole: "Software Engineer", q: "engineer" }).granularRole,
    ).toBe("Software Engineer");
    expect(
      searchQuerySchema.parse({
        granularRole: "software-it/software-engineering",
        q: "engineer",
      }).granularRole,
    ).toBe("software-it/software-engineering");
  });

  test("accepts the category and granular role together", () => {
    const parsed = searchQuerySchema.parse({
      category: "software-it",
      granularRole: "Data Engineer",
      q: "engineer",
    });

    expect(parsed.category).toBe("software-it");
    expect(parsed.granularRole).toBe("Data Engineer");
  });

  test("rejects an unknown category or granular role", () => {
    expect(() => searchQuerySchema.parse({ category: "not-a-category", q: "engineer" })).toThrow();
    expect(() => searchQuerySchema.parse({ granularRole: "not-a-role", q: "engineer" })).toThrow();
  });
});
