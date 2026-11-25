import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import { roleTaxonomyName } from "../../shared/role-taxonomy.ts";

import { descriptionSummary, postingRoleName, scoreTagsLine, targetsLine } from "./judge-input.ts";

const NURSE_TAGS = [
  { dimension: "role", value: "healthcare" },
  { dimension: "subrole", value: "healthcare/nursing" },
  { dimension: "granular_role", value: "health.rn" },
  { dimension: "seniority", value: "mid" },
];

describe("role names", () => {
  test("a taxonomy id reads as its name and anything else stays as given", () => {
    expect(roleTaxonomyName("health.rn")).toBe("Registered Nurse");
    expect(roleTaxonomyName("healthcare")).toBe("Healthcare");
    expect(roleTaxonomyName("ICU nurse")).toBe("ICU nurse");
  });

  test("the most specific role tag names the Posting", () => {
    expect(postingRoleName(NURSE_TAGS)).toBe("Registered Nurse");
    expect(postingRoleName(NURSE_TAGS.filter((tag) => tag.dimension !== "granular_role"))).toBe(
      "Nursing",
    );
    expect(postingRoleName([{ dimension: "role", value: "healthcare" }])).toBe("Healthcare");
    expect(postingRoleName([{ dimension: "seniority", value: "mid" }])).toBeNull();
  });

  test("the scorer's tags line names the role and the seniority", () => {
    expect(scoreTagsLine(NURSE_TAGS)).toBe("role:Registered Nurse seniority:mid");
    expect(scoreTagsLine([])).toBe("");
  });
});

describe("descriptionSummary", () => {
  test("keeps the first 200 words, capped at 2,000 characters", () => {
    const words = Array.from({ length: 300 }, (_, index) => `w${String(index)}`);
    const summary = descriptionSummary(gzipSync(` ${words.join("  \n ")} `));

    expect(summary.split(" ")).toHaveLength(200);
    expect(summary.startsWith("w0 w1 w2")).toBe(true);
    expect(descriptionSummary(gzipSync("x".repeat(5000)))).toHaveLength(2000);
  });

  test("reads nothing from a missing or unreadable description", () => {
    expect(descriptionSummary(null)).toBe("");
    expect(descriptionSummary(new Uint8Array([1, 2, 3]))).toBe("");
  });
});

describe("targetsLine", () => {
  test("names roles, levels, places, workplaces and the pay floor", () => {
    expect(
      targetsLine({
        roles: ["health.rn", "Registered Nurse", "ICU charge nurse"],
        seniorities: ["mid"],
        workplaces: ["onsite"],
        locations: ["Houston, TX"],
        employmentTypes: ["full_time"],
        salaryFloorMinor: 7_000_000,
        salaryCurrency: "USD",
        salaryPeriod: "year",
      }),
    ).toBe(
      "roles: Registered Nurse, ICU charge nurse; level: mid; places: Houston, TX; workplace: onsite; pay floor: USD 70,000/year",
    );
  });

  test("leaves out what the person did not set", () => {
    expect(
      targetsLine({
        roles: ["Software Engineering"],
        seniorities: [],
        workplaces: [],
        locations: [],
        employmentTypes: [],
        salaryFloorMinor: null,
        salaryCurrency: null,
        salaryPeriod: "year",
      }),
    ).toBe("roles: Software & IT");
  });
});
