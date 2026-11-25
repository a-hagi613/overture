import { describe, expect, test } from "bun:test";

import { ESCO_ROLE_OPTIONS } from "../../shared/esco-roles.ts";
import { ROLE_CATEGORIES, ROLES, ROLE_SUBCATEGORIES } from "../../shared/role-taxonomy.ts";
import { ROLE_GROUPS, SUBROLES } from "../../shared/tag-taxonomy.ts";

import { legacyTagToTaxonomy, legacyTargetToTaxonomy, titleNamedRole } from "./legacy-roles.ts";

const roleIds = new Set(ROLES.map((role) => role.id));
const categoryIds = new Set<string>(ROLE_CATEGORIES.map((category) => category.id));

describe("the role taxonomy", () => {
  test("has 29 categories and 272 roles with unique ids", () => {
    expect(ROLE_CATEGORIES).toHaveLength(29);
    expect(ROLES).toHaveLength(272);
    expect(roleIds.size).toBe(272);
    expect(new Set(ROLE_SUBCATEGORIES.map((sub) => sub.id)).size).toBe(ROLE_SUBCATEGORIES.length);
  });

  test("every role sits in a known subcategory of its own category", () => {
    const subcategories = new Map(ROLE_SUBCATEGORIES.map((sub) => [sub.id, sub]));

    for (const role of ROLES) {
      expect(subcategories.get(role.subcategoryId)?.categoryId).toBe(role.categoryId);
    }
  });

  test("role, subcategory and category ids never collide", () => {
    const all = [...roleIds, ...categoryIds, ...ROLE_SUBCATEGORIES.map((sub) => sub.id)];

    expect(new Set(all).size).toBe(all.length);
  });
});

describe("legacy tags map onto the taxonomy", () => {
  test("every old Level-2 role maps to a known role or category", () => {
    for (const option of ESCO_ROLE_OPTIONS) {
      const mapped = legacyTagToTaxonomy({ category: option.category, role: option.role });

      if (mapped.roleId !== null) {
        expect(roleIds.has(mapped.roleId)).toBe(true);
      }

      if (mapped.categoryId !== null) {
        expect(categoryIds.has(mapped.categoryId)).toBe(true);
      }
    }
  });

  test("a granular old role lands on its new role and that role's category", () => {
    expect(legacyTagToTaxonomy({ category: "Healthcare", role: "Registered Nurse" })).toEqual({
      categoryId: "healthcare",
      roleId: "health.rn",
    });
    expect(legacyTagToTaxonomy({ category: "Healthcare", role: "Medical Assistant" })).toEqual({
      categoryId: "care-health-support",
      roleId: "care.ma",
    });
  });

  test("a category-only tag keeps just the category", () => {
    expect(legacyTagToTaxonomy({ category: "Healthcare", role: "Healthcare" })).toEqual({
      categoryId: "healthcare",
      roleId: null,
    });
  });

  test("an ambiguous old category is dropped rather than guessed", () => {
    expect(legacyTagToTaxonomy({ category: "Security", role: null })).toEqual({
      categoryId: null,
      roleId: null,
    });
    expect(legacyTagToTaxonomy({ category: "Operations", role: "Operations" })).toEqual({
      categoryId: null,
      roleId: null,
    });
  });

  test("a vague old role becomes a broad role, never a specific one", () => {
    const mapped = legacyTagToTaxonomy({ category: "Sales", role: "Sales Representative" });

    expect(ROLES.find((role) => role.id === mapped.roleId)?.broad).toBe(true);
  });

  test("software subroles map to their engineering roles", () => {
    expect(legacyTagToTaxonomy({ category: null, role: null, subrole: "Backend" }).roleId).toBe(
      "sw.backend",
    );

    for (const subrole of SUBROLES) {
      expect(legacyTagToTaxonomy({ category: null, role: null, subrole }).roleId).not.toBeNull();
    }
  });
});

describe("legacy saved targets map onto the taxonomy", () => {
  test("every old category maps to at least one new id", () => {
    for (const group of ROLE_GROUPS) {
      const ids = legacyTargetToTaxonomy(group);

      expect(ids.length).toBeGreaterThan(0);

      for (const id of ids) {
        expect(roleIds.has(id) || categoryIds.has(id)).toBe(true);
      }
    }
  });

  test("an old role name becomes its role id, case-insensitively", () => {
    expect(legacyTargetToTaxonomy("registered nurse")).toEqual(["health.rn"]);
  });

  test("an ambiguous old category keeps both readings for a saved target", () => {
    expect(legacyTargetToTaxonomy("Security").toSorted()).toEqual([
      "it.security",
      "protective-services",
    ]);
  });

  test("an id that is already new passes through", () => {
    expect(legacyTargetToTaxonomy("trade.electrician")).toEqual(["trade.electrician"]);
    expect(legacyTargetToTaxonomy("skilled-trades")).toEqual(["skilled-trades"]);
  });

  test("free text is kept as typed", () => {
    expect(legacyTargetToTaxonomy("Kotlin backend")).toEqual(["Kotlin backend"]);
  });
});

describe("current taxonomy names resolve to their ids", () => {
  test("a role, subcategory or category name becomes its id, case-insensitively", () => {
    expect(legacyTargetToTaxonomy("Backend Engineer")).toEqual(["sw.backend"]);
    expect(legacyTargetToTaxonomy("electrician")).toEqual(["trade.electrician"]);
    expect(legacyTargetToTaxonomy("Skilled Trades")).toEqual(["skilled-trades"]);
    expect(legacyTargetToTaxonomy("Software Engineer (general)")).toEqual(["sw.general"]);
  });

  test("a category name wins over a subcategory that shares it, and a repeated subcategory name names none", () => {
    expect(legacyTargetToTaxonomy("Engineering")).toEqual(["engineering"]);
    expect(legacyTargetToTaxonomy("Healthcare")).toEqual(["healthcare"]);
    expect(legacyTargetToTaxonomy("Supervision")).toEqual(["Supervision"]);
    expect(legacyTargetToTaxonomy("Business systems")).toEqual(["software-it/business-systems"]);
  });

  test("one part of a combined role name reaches that role when it clearly names a job", () => {
    expect(legacyTargetToTaxonomy("Platform Engineer")).toEqual(["infra.devops"]);
    expect(legacyTargetToTaxonomy("nurse practitioner")).toEqual(["health.np"]);
    expect(legacyTargetToTaxonomy("Paramedic")).toEqual(["health.ems"]);
    expect(legacyTargetToTaxonomy("Help Desk")).toEqual(["it.support"]);
  });

  test("a level word does not hide the role it qualifies, and a role named with one keeps it", () => {
    expect(legacyTargetToTaxonomy("Senior Backend Engineer")).toEqual(["sw.backend"]);
    expect(legacyTargetToTaxonomy("Sr. Data Engineer II")).toEqual(["data.engineer"]);
    expect(legacyTargetToTaxonomy("Shift Lead")).toEqual(["food.supervisor"]);
    expect(legacyTargetToTaxonomy("Lead Project Manager")).toEqual(["ops.pm"]);
    expect(legacyTargetToTaxonomy("Principal Engineer")).toEqual(["Principal Engineer"]);
  });

  test("a title names a role only by a role's own name, never a broad one", () => {
    expect(titleNamedRole("Staff Software Engineer")).toBe("sw.general");
    expect(titleNamedRole("Registered Nurse")).toBe("health.rn");
    expect(titleNamedRole("Registered Nurse - ICU Nights")).toBeNull();
    expect(titleNamedRole("Head of Sales")).toBeNull();
  });

  test("a vague or shared part stays free text, so it never claims one role", () => {
    expect(legacyTargetToTaxonomy("Analyst")).toEqual(["Analyst"]);
    expect(legacyTargetToTaxonomy("Assistant")).toEqual(["Assistant"]);
    expect(legacyTargetToTaxonomy("Coordinator")).toEqual(["Coordinator"]);
    expect(legacyTargetToTaxonomy("IT")).toEqual(["IT"]);
  });

  test("every current name resolves back to an id that names it", () => {
    for (const role of ROLES) {
      const [id] = legacyTargetToTaxonomy(role.name);

      expect(ROLES.find((candidate) => candidate.id === id)?.name.toLowerCase()).toBe(
        role.name.toLowerCase(),
      );
    }
  });
});
