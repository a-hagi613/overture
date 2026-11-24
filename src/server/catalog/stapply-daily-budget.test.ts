import { describe, expect, test } from "bun:test";

import { CATALOG_SIZE_BUDGET_BYTES, assertCatalogSizeWithinBudget } from "./stapply-daily.ts";

describe("the catalog disk budget gate", () => {
  test("a snapshot under 2.5 GB passes", () => {
    expect(assertCatalogSizeWithinBudget(CATALOG_SIZE_BUDGET_BYTES - 1)).toBe(
      CATALOG_SIZE_BUDGET_BYTES - 1,
    );
    expect(CATALOG_SIZE_BUDGET_BYTES).toBe(2_500_000_000);
  });

  test("a snapshot at or over 2.5 GB refuses to publish", () => {
    expect(() => assertCatalogSizeWithinBudget(CATALOG_SIZE_BUDGET_BYTES)).toThrow(/budget/u);
    expect(() => assertCatalogSizeWithinBudget(CATALOG_SIZE_BUDGET_BYTES + 1)).toThrow(/budget/u);
  });
});
