import { describe, expect, test } from "bun:test";

import { ROLE_GROUPS } from "../../shared/tag-taxonomy.ts";

import { categoryFor, granularRoleNameFor } from "./esco-mapping.ts";
import {
  ESCO_CATEGORIES,
  ESCO_OCCUPATION_COUNT,
  ESCO_ROLES,
  ESCO_VERSION,
  allLabels,
  classifyWithEsco,
  escoOccupations,
  escoPrototypes,
  escoRolePrototypes,
  lookupEscoOccupations,
} from "./esco-taxonomy.ts";

describe("the baked ESCO dataset", () => {
  test("is v1.2.1 and carries the full occupation list", () => {
    expect(ESCO_VERSION).toBe("1.2.1");
    expect(ESCO_OCCUPATION_COUNT).toBeGreaterThan(2_900);
    expect(escoOccupations()).toHaveLength(ESCO_OCCUPATION_COUNT);
  });

  test("rolls every occupation up to a real Level-1 category and a Level-2 role", () => {
    const categories = new Set(ROLE_GROUPS);

    for (const occupation of escoOccupations()) {
      expect(categories.has(occupation.category)).toBe(true);
      expect(occupation.role.length).toBeGreaterThan(0);
      expect(occupation.code).toMatch(/^\d{4}\.\d+/u);
      expect(occupation.isco).toMatch(/^\d{4}$/u);
    }
  });

  test("keeps the 28-language preferred labels", () => {
    const languages = new Set<string>();

    for (const occupation of escoOccupations().slice(0, 200)) {
      for (const language of Object.keys(occupation.labels)) {
        languages.add(language);
      }
    }

    for (const language of ["en", "de", "fr", "es"]) {
      expect(languages.has(language)).toBe(true);
    }
  });

  test("covers the Administrative gap", () => {
    expect(ESCO_CATEGORIES).toContain("Administrative");

    const administrativeRoles = new Set(
      escoOccupations()
        .filter((occupation) => occupation.category === "Administrative")
        .map((occupation) => occupation.role),
    );

    expect(administrativeRoles.size).toBeGreaterThan(3);
    expect(administrativeRoles.has("Office Manager")).toBe(true);
  });

  test("has a human-sized Level-2 vocabulary", () => {
    expect(ESCO_ROLES.length).toBeGreaterThanOrEqual(120);
    expect(ESCO_ROLES.length).toBeLessThanOrEqual(160);
  });

  test("bakes the same category and role the mapping rules produce", () => {
    for (const occupation of escoOccupations()) {
      const en = occupation.labels.en ?? "";
      const category = categoryFor({ en, isco: occupation.isco });

      expect(category).toBe(occupation.category);
      expect(granularRoleNameFor({ category, en })).toBe(occupation.role);
    }
  });

  test("indexes every label for the alias lookup", () => {
    const occupation = escoOccupations()[0];

    if (occupation === undefined) {
      throw new Error("the dataset has no occupations");
    }

    expect(allLabels(occupation).length).toBeGreaterThan(0);
  });

  test("classifies English, German, French and Spanish labels", () => {
    expect(classifyWithEsco("software developer")?.category).toBe("Software Engineering");

    for (const title of [
      "Datenbankadministrator",
      "administrateur de base de données",
      "administrador de bases de datos",
    ]) {
      expect(lookupEscoOccupations(title)).not.toBeNull();
    }
  });

  test("builds role and occupation prototypes once", () => {
    const roles = escoRolePrototypes();
    const occupations = escoPrototypes();

    expect(roles.length).toBeGreaterThan(100);
    expect(occupations.length).toBeGreaterThan(2_000);
    expect(new Set(occupations.map((prototype) => prototype.text)).size).toBe(occupations.length);
  });
});
