import { describe, expect, test } from "bun:test";

import {
  planRoleTargets,
  ROLE_MATCH_SCORE,
  roleFilterTagValues,
  roleMatchScore,
} from "./role-targets.ts";

function posting(titleNorm: string, tags: readonly [string, string][]) {
  return { titleNorm, tags: tags.map(([dimension, value]) => ({ dimension, value })) };
}

const NURSE = posting("registered nurse icu", [
  ["role", "healthcare"],
  ["subrole", "healthcare/nursing"],
  ["granular_role", "health.rn"],
]);

const PRACTITIONER = posting("nurse practitioner", [
  ["role", "healthcare"],
  ["subrole", "healthcare/nursing"],
  ["granular_role", "health.np"],
]);

const PHYSICIAN = posting("hospitalist physician", [
  ["role", "healthcare"],
  ["subrole", "healthcare/physicians"],
  ["granular_role", "health.physician"],
]);

describe("planRoleTargets", () => {
  test("reads ids, current names, retired names and free text", () => {
    const plan = planRoleTargets([
      "health.rn",
      "Backend Engineer",
      "Data & Analytics",
      "healthcare/nursing",
      "Frontend",
      "ICU charge nurse",
    ]);

    expect([...plan.exactRoleIds].toSorted()).toEqual(["health.rn", "sw.backend", "sw.frontend"]);
    expect([...plan.subcategoryIds]).toEqual(["healthcare/nursing"]);
    expect([...plan.categoryIds]).toEqual(["data-ai"]);
    expect(plan.freeTextWords).toEqual([["icu", "charge", "nurse"]]);
  });

  test("drops stop words and single letters from free text, and a target of only those", () => {
    expect(planRoleTargets(["Head of Sales and Growth"]).freeTextWords).toEqual([
      ["head", "sales", "growth"],
    ]);
    expect(planRoleTargets(["a of the"]).freeTextWords).toEqual([]);
  });
});

describe("roleMatchScore", () => {
  test("a role target scores only that role, never a neighbour in its subcategory", () => {
    const plan = planRoleTargets(["Registered Nurse"]);

    expect(roleMatchScore(plan, NURSE)).toBe(ROLE_MATCH_SCORE.exact);
    expect(roleMatchScore(plan, PRACTITIONER)).toBe(0);
  });

  test("the closest way the Posting meets the targets wins", () => {
    const plan = planRoleTargets(["health.rn", "healthcare/nursing", "healthcare"]);

    expect(roleMatchScore(plan, NURSE)).toBe(ROLE_MATCH_SCORE.exact);
    expect(roleMatchScore(plan, PRACTITIONER)).toBe(ROLE_MATCH_SCORE.subcategory);
    expect(roleMatchScore(plan, PHYSICIAN)).toBe(ROLE_MATCH_SCORE.category);
  });

  test("free text needs every word as a whole title word", () => {
    expect(roleMatchScore(planRoleTargets(["ICU nurse"]), NURSE)).toBe(ROLE_MATCH_SCORE.freeText);
    expect(roleMatchScore(planRoleTargets(["ICU nurse"]), PRACTITIONER)).toBe(0);
    expect(roleMatchScore(planRoleTargets(["nur"]), NURSE)).toBe(0);
  });

  test("a Posting with no role tags and no title match scores zero", () => {
    expect(roleMatchScore(planRoleTargets(["Registered Nurse"]), posting("talent pool", []))).toBe(
      0,
    );
  });
});

describe("roleFilterTagValues", () => {
  test("lists the taxonomy ids and the value as given, so an older catalog still answers", () => {
    expect(roleFilterTagValues("Registered Nurse")).toEqual(["health.rn", "Registered Nurse"]);
    expect(roleFilterTagValues("Software Engineering")).toEqual([
      "software-it",
      "Software Engineering",
    ]);
    expect(roleFilterTagValues("healthcare")).toEqual(["healthcare"]);
  });
});
