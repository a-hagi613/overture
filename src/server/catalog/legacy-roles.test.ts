import { describe, expect, test } from "bun:test";

import { ESCO_ROLE_OPTIONS } from "../../shared/esco-roles.ts";
import { ROLE_CATEGORIES, ROLES, ROLE_SUBCATEGORIES } from "../../shared/role-taxonomy.ts";
import { ROLE_GROUPS, SUBROLES } from "../../shared/tag-taxonomy.ts";

import { legacyTagToTaxonomy, legacyTargetToTaxonomy } from "./legacy-roles.ts";

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
