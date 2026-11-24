import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { ROLE_GROUPS } from "./tag-taxonomy.ts";
import {
  ESCO_GRANULAR_ROLE_OPTIONS,
  ESCO_ROLE_NAMES,
  ESCO_ROLE_OPTIONS,
  escoGranularRolesFor,
  escoRoleCategory,
  isEscoRole,
} from "./esco-roles.ts";

const datasetSchema = z.object({
  occupations: z.array(z.object({ c: z.enum(ROLE_GROUPS), r: z.string() })),
});

const dataset = datasetSchema.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dir, "..", "server", "catalog", "tag-data", "esco-occupations.json"),
      "utf8",
    ),
  ),
);

function datasetOptions() {
  const pairs = new Map(dataset.occupations.map((row) => [`${row.c}|${row.r}`, row]));

  return [...pairs.values()]
    .map((row) => ({ category: row.c, role: row.r }))
    .toSorted(
      (left, right) =>
        ROLE_GROUPS.indexOf(left.category) - ROLE_GROUPS.indexOf(right.category) ||
        left.role.localeCompare(right.role, "en"),
    );
}

describe("the compact ESCO role vocabulary", () => {
  test("matches the baked dataset's 134 Level-2 roles exactly", () => {
    expect(ESCO_ROLE_OPTIONS).toEqual(datasetOptions());
    expect(ESCO_ROLE_NAMES.length).toBe(ESCO_ROLE_OPTIONS.length);
    expect(ESCO_ROLE_NAMES.length).toBeGreaterThanOrEqual(120);
    expect(ESCO_ROLE_NAMES.length).toBeLessThanOrEqual(160);
  });

  test("offers every real granular role once and hides category-equal fallbacks", () => {
    expect(ESCO_GRANULAR_ROLE_OPTIONS).not.toContainEqual(
      expect.objectContaining({ category: "Software Engineering", role: "Software Engineering" }),
    );
    expect(ESCO_GRANULAR_ROLE_OPTIONS.length).toBe(
      ESCO_ROLE_OPTIONS.filter((option) => option.role !== option.category).length,
    );
    expect(new Set(ESCO_GRANULAR_ROLE_OPTIONS.map((option) => option.role)).size).toBe(
      ESCO_GRANULAR_ROLE_OPTIONS.length,
    );
  });

  test("narrows roles by category and answers both lookup helpers", () => {
    const administrative = escoGranularRolesFor("Administrative");

    expect(administrative.map((option) => option.role)).toEqual([
      "Administrative Assistant",
      "Data Entry Clerk",
      "Executive Assistant",
      "Office Clerk",
      "Office Manager",
      "Receptionist",
      "Secretary",
    ]);
    expect(escoGranularRolesFor(null)).toHaveLength(ESCO_GRANULAR_ROLE_OPTIONS.length);
    expect(escoRoleCategory("Backend Engineer")).toBeNull();
    expect(escoRoleCategory("Software Engineer")).toBe("Software Engineering");
    expect(isEscoRole("Registered Nurse")).toBe(true);
    expect(isEscoRole("Wizard")).toBe(false);
  });

  test("stays a compact client module: no synonym table and a small source file", () => {
    const source = readFileSync(join(import.meta.dir, "esco-roles.ts"), "utf8");

    expect(source).not.toContain("tag-data/");
    expect(source).not.toContain("escoOccupationsJson");
    expect(source).not.toContain("altLabels");
    expect(Buffer.byteLength(source, "utf8")).toBeLessThan(64_000);
  });
});
