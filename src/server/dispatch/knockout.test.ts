import { describe, expect, test } from "bun:test";

import {
  countryFromText,
  evaluateKnockout,
  knockoutPreScan,
  knockoutProfileFromFacts,
  knockoutStatusReason,
  parseKnockoutRules,
  parseYearsValue,
} from "./knockout.ts";
import type { KnockoutPosting, KnockoutProfile } from "./knockout.ts";

const posting = (description: string, extra: Partial<KnockoutPosting> = {}) =>
  ({
    countryCode: null,
    description,
    locationRaw: null,
    title: "Senior Engineer",
    workplace: null,
    ...extra,
  }) satisfies KnockoutPosting;

function profile(overrides: Partial<KnockoutProfile> = {}) {
  return {
    currentCountry: "CA",
    sponsorshipRequired: null,
    willingRelocate: null,
    workAuthByCountry: new Map<string, string>(),
    workAuthUnscoped: null,
    yearsTotal: null,
    ...overrides,
  } satisfies KnockoutProfile;
}

describe("countryFromText", () => {
  test("reads country names, ISO codes and dotted abbreviations in five languages", () => {
    expect(countryFromText("Toronto, Canada")).toBe("CA");
    expect(countryFromText("Berlin, Deutschland")).toBe("DE");
    expect(countryFromText("Paris, France")).toBe("FR");
    expect(countryFromText("Madrid, España")).toBe("ES");
    expect(countryFromText("東京, 日本")).toBe("JP");
    expect(countryFromText("US")).toBe("US");
    expect(countryFromText("must work in the U.S.")).toBe("US");
    expect(countryFromText("somewhere else")).toBeNull();
  });
});

describe("parseKnockoutRules", () => {
  test("reads an English no-sponsorship screen and the country it names", () => {
    const rules = parseKnockoutRules(
      posting(
        "You must be authorized to work in the United States. We are unable to sponsor visas for this role.",
      ),
    );

    expect(rules).toEqual({
      minYears: null,
      noSponsorship: true,
      remote: false,
      requiredResidenceCountry: null,
      requiredWorkCountry: "US",
    });
  });

  test("reads German, French and Spanish screens", () => {
    expect(
      parseKnockoutRules(posting("Sie benötigen eine Arbeitsberechtigung für Deutschland."))
        .requiredWorkCountry,
    ).toBe("DE");

    expect(
      parseKnockoutRules(posting("Une autorisation de travail en France est obligatoire."))
        .requiredWorkCountry,
    ).toBe("FR");

    expect(
      parseKnockoutRules(posting("Se requiere autorización para trabajar en España."))
        .requiredWorkCountry,
    ).toBe("ES");
  });

  test("reads a minimum-experience screen and ignores a preferred one", () => {
    expect(
      parseKnockoutRules(posting("At least 5 years of experience in backend work.")).minYears,
    ).toBe(5);

    expect(
      parseKnockoutRules(posting("3+ years of experience with TypeScript is required.")).minYears,
    ).toBe(3);

    expect(
      parseKnockoutRules(posting("At least 5 years of experience is preferred.")).minYears,
    ).toBeNull();
  });

  test("never treats an unrelated number of years as an experience screen", () => {
    expect(parseKnockoutRules(posting("You must be at least 18 years old.")).minYears).toBeNull();
  });

  test("reads a required place of residence", () => {
    expect(
      parseKnockoutRules(posting("Candidates must be based in Canada for this role."))
        .requiredResidenceCountry,
    ).toBe("CA");
  });
});

describe("evaluateKnockout", () => {
  test("skips a candidate whose profile requires sponsorship the role will not offer", () => {
    const rules = parseKnockoutRules(posting("We do not offer visa sponsorship for this role."));

    expect(
      evaluateKnockout(rules, profile({ sponsorshipRequired: "Yes, I require sponsorship" })),
    ).toMatchObject({ code: "sponsorship", eligible: false });
  });

  test("keeps a candidate who needs no sponsorship", () => {
    const rules = parseKnockoutRules(posting("We do not offer visa sponsorship for this role."));

    expect(evaluateKnockout(rules, profile({ sponsorshipRequired: "No" }))).toEqual({
      eligible: true,
    });

    expect(evaluateKnockout(rules, profile())).toEqual({ eligible: true });
  });

  test("skips a candidate whose country-scoped work authorization is a clear no", () => {
    const rules = parseKnockoutRules(posting("You must be authorized to work in the US."));

    const verdict = evaluateKnockout(
      rules,
      profile({ workAuthByCountry: new Map([["US", "Not authorized, I need a visa"]]) }),
    );

    expect(verdict).toMatchObject({ code: "work_authorization", eligible: false });
  });

  test("never skips when the work authorization is unknown", () => {
    const rules = parseKnockoutRules(posting("You must be authorized to work in the US."));

    expect(evaluateKnockout(rules, profile())).toEqual({ eligible: true });
    expect(
      evaluateKnockout(rules, profile({ workAuthByCountry: new Map([["US", "Citizen"]]) })),
    ).toEqual({ eligible: true });
  });

  test("skips a candidate clearly below a numeric minimum", () => {
    const rules = parseKnockoutRules(posting("Minimum of 7 years of experience required."));

    expect(evaluateKnockout(rules, profile({ yearsTotal: "3" }))).toMatchObject({
      code: "experience",
      eligible: false,
    });

    expect(evaluateKnockout(rules, profile({ yearsTotal: "9 years" }))).toEqual({ eligible: true });
    expect(evaluateKnockout(rules, profile())).toEqual({ eligible: true });
  });

  test("skips only an explicit non-relocating country mismatch", () => {
    const rules = parseKnockoutRules(posting("This role must be based in Germany."));

    expect(
      evaluateKnockout(
        rules,
        profile({ currentCountry: "CA", willingRelocate: "No, I cannot relocate" }),
      ),
    ).toMatchObject({ code: "location", eligible: false });

    expect(
      evaluateKnockout(rules, profile({ currentCountry: "CA", willingRelocate: "Yes" })),
    ).toEqual({ eligible: true });

    expect(
      evaluateKnockout(rules, profile({ currentCountry: "DE", willingRelocate: "No" })),
    ).toEqual({ eligible: true });
  });
});

describe("knockoutPreScan", () => {
  test("returns a structured skip with a plain-English explanation and status reason", () => {
    const skip = knockoutPreScan({
      posting: posting("We are unable to sponsor a visa for this position."),
      profile: profile({ sponsorshipRequired: "yes" }),
    });

    expect(skip).toMatchObject({ code: "sponsorship", outcome: "knockout_ineligible" });
    expect(skip?.statusReason).toBe("knockout_sponsorship");
    expect(skip?.explanation).toContain("visa sponsorship");
  });

  test("returns null for a posting with no screen", () => {
    expect(
      knockoutPreScan({
        posting: posting("Build delightful forms."),
        profile: profile({ yearsTotal: "1", sponsorshipRequired: "yes" }),
      }),
    ).toBeNull();
  });

  test("derives the profile view from the Fact index", () => {
    const view = knockoutProfileFromFacts({
      scoped: new Map([["work_auth", new Map([["US", "Citizen"]])]]),
      unscoped: new Map([
        ["current_country", "Canada"],
        ["sponsorship_required", "No"],
        ["years_total", "8"],
        ["willing_relocate", "Yes"],
      ]),
    });

    expect(view).toMatchObject({
      currentCountry: "CA",
      sponsorshipRequired: "No",
      yearsTotal: "8",
      willingRelocate: "Yes",
    });
    expect(view.workAuthByCountry.get("US")).toBe("Citizen");
  });
});

describe("helpers", () => {
  test("parses a years Fact value", () => {
    expect(parseYearsValue("7")).toBe(7);
    expect(parseYearsValue("7.5 years")).toBe(7.5);
    expect(parseYearsValue("none")).toBeNull();
    expect(parseYearsValue(null)).toBeNull();
  });

  test("names each status reason after its code", () => {
    expect(knockoutStatusReason("experience")).toBe("knockout_experience");
  });
});
