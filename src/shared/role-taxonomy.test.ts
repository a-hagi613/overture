import { describe, expect, test } from "bun:test";

import { ROLES, pickableRoles, roleCategoryById, roleCategoryOf } from "./role-taxonomy.ts";

describe("the role pickers", () => {
  test("offer a category's specific roles and never its catch-all", () => {
    const names = pickableRoles("healthcare").map((role) => role.name);

    expect(names).toContain("Registered Nurse");
    expect(names).toContain("Nurse Practitioner / Anesthetist / Midwife");
    expect(names).not.toContain("Other Health Practitioner");
    expect(pickableRoles("healthcare").every((role) => role.categoryId === "healthcare")).toBe(
      true,
    );
  });

  test("offer every specific role when no category is chosen", () => {
    expect(pickableRoles(null)).toHaveLength(ROLES.filter((role) => !role.broad).length);
  });

  test("read a category only from its id", () => {
    expect(roleCategoryById("software-it")?.name).toBe("Software & IT");
    expect(roleCategoryById("Software & IT")).toBeUndefined();
    expect(roleCategoryById("retail")).toBeUndefined();
  });

  test("find the category a saved role, subcategory or category belongs to", () => {
    expect(roleCategoryOf("Registered Nurse")).toBe("healthcare");
    expect(roleCategoryOf("health.rn")).toBe("healthcare");
    expect(roleCategoryOf("software-it/software-engineering")).toBe("software-it");
    expect(roleCategoryOf("Data & AI")).toBe("data-ai");
    expect(roleCategoryOf("Puppetry Workshop Steward")).toBeNull();
  });
});
