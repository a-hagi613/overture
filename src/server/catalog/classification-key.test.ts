import { describe, expect, test } from "bun:test";

import {
  aliasLookupTitle,
  classificationKey,
  classificationTitle,
  normalizeClassificationText,
  stripGenderMarkers,
  stripTrailingLocation,
} from "./classification-key.ts";

describe("stripGenderMarkers", () => {
  test("removes the EU gender markers without touching the role", () => {
    expect(stripGenderMarkers("Senior Backend Engineer (m/w/d)")).toBe("Senior Backend Engineer");
    expect(stripGenderMarkers("Entwickler (f/m/x)")).toBe("Entwickler");
    expect(stripGenderMarkers("Datenbankadministrator (w/m/d)")).toBe("Datenbankadministrator");
    expect(stripGenderMarkers("Ingénieur m/f/d")).toBe("Ingénieur");
  });
});

describe("stripTrailingLocation", () => {
  test("drops a trailing city or country but keeps the seniority qualifier", () => {
    expect(stripTrailingLocation("Senior Backend Engineer - Berlin")).toBe(
      "Senior Backend Engineer",
    );
    expect(stripTrailingLocation("Data Engineer | Remote")).toBe("Data Engineer");
    expect(stripTrailingLocation("Office Manager, London, United Kingdom")).toBe("Office Manager");
    expect(stripTrailingLocation("Receptionist in Paris")).toBe("Receptionist");
  });

  test("does not shorten a title whose last segment is part of the role", () => {
    expect(stripTrailingLocation("Head of Engineering")).toBe("Head of Engineering");
    expect(stripTrailingLocation("Director of Sales, Marketing")).toBe(
      "Director of Sales, Marketing",
    );
  });
});

describe("classificationTitle", () => {
  test("combines the gender and location cleanup", () => {
    expect(classificationTitle("Senior Developer (m/w/d) - Munich")).toBe("Senior Developer");
  });
});

describe("classificationKey", () => {
  test("keeps seniority and level tokens while dropping the location", () => {
    const senior = classificationKey("Senior Engineer II - Berlin", "Engineering");
    const plain = classificationKey("Engineer II", null);

    expect(senior.titleNorm).toContain("senior");
    expect(senior.titleNorm).toContain("ii");
    expect(senior.titleNorm).not.toContain("berlin");
    expect(senior.deptNorm).toBe("engineering");
    expect(senior.key).not.toBe(plain.key);
  });

  test("separates II and III openings", () => {
    expect(classificationKey("Engineer II", null).key).not.toBe(
      classificationKey("Engineer III", null).key,
    );
  });
});

describe("normalizeClassificationText", () => {
  test("folds accents but keeps non-Latin scripts", () => {
    expect(normalizeClassificationText("Ingénieur")).toBe("ingenieur");
    expect(normalizeClassificationText("データベース管理者")).toBe("データベース管理者");
    expect(normalizeClassificationText("ソフトウェアエンジニア (m/w/d)")).toContain(
      "ソフトウェアエンジニア",
    );
  });
});

describe("aliasLookupTitle", () => {
  test("drops seniority qualifiers for the ESCO alias lookup", () => {
    expect(aliasLookupTitle("Senior Backend Engineer")).toBe("backend engineer");
    expect(aliasLookupTitle("Junior Data Analyst")).toBe("data analyst");
  });
});
