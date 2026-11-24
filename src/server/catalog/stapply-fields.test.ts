import { describe, expect, test } from "bun:test";

import {
  hasUsableRequisitionId,
  normalizeExactTitle,
  parseSkillRequirements,
  parseStapplyLocations,
  stapplyLocationKey,
} from "./stapply-fields.ts";

describe("hasUsableRequisitionId", () => {
  test("rejects the junk strings mirrors write", () => {
    for (const value of [null, undefined, "", "  ", "null", "N/A", "none", "tbd", "-", "0"]) {
      expect(hasUsableRequisitionId(value)).toBe(false);
    }
  });

  test("accepts a real id", () => {
    expect(hasUsableRequisitionId("ENG-7")).toBe(true);
  });
});

describe("normalizeExactTitle", () => {
  test("keeps level and seniority tokens apart", () => {
    expect(normalizeExactTitle("Engineer II")).toBe("engineer ii");
    expect(normalizeExactTitle("Engineer III")).toBe("engineer iii");
    expect(normalizeExactTitle("Senior Engineer")).not.toBe(normalizeExactTitle("Engineer"));
    expect(normalizeExactTitle("Software Engineer (m/w/d)")).toBe("software engineer");
  });
});

describe("parseStapplyLocations", () => {
  test("parses the primary location first", () => {
    const locations = parseStapplyLocations(
      JSON.stringify([
        { country_iso: "PL", label: "Poland" },
        { country_iso: "GB", is_primary: true, label: "London" },
      ]),
    );

    expect(locations[0]?.label).toBe("London");
    expect(locations[0]?.countryCode).toBe("GB");
  });

  test("treats a non-JSON value as a single label", () => {
    expect(parseStapplyLocations("Berlin").map((location) => location.label)).toEqual(["Berlin"]);
  });
});

describe("stapplyLocationKey", () => {
  test("keeps countries apart and normalizes the label", () => {
    const berlin = stapplyLocationKey({
      countryCode: "DE",
      location: "Berlin, Germany",
      locations: null,
    });

    expect(berlin).toBe("DE|berlin germany");
    expect(stapplyLocationKey({ countryCode: "US", location: "Remote", locations: null })).not.toBe(
      stapplyLocationKey({ countryCode: "DE", location: "Remote", locations: null }),
    );
  });
});

describe("parseSkillRequirements", () => {
  test("extracts names from strings and objects", () => {
    expect(
      parseSkillRequirements(JSON.stringify(["TypeScript", { name: "SQL" }, { label: "Docker" }])),
    ).toEqual(["TypeScript", "SQL", "Docker"]);
  });

  test("accepts a plain comma-separated value", () => {
    expect(parseSkillRequirements("Python, Go, Rust")).toEqual(["Python", "Go", "Rust"]);
  });

  test("returns an empty list for empty input", () => {
    expect(parseSkillRequirements(null)).toEqual([]);
    expect(parseSkillRequirements("")).toEqual([]);
  });
});
