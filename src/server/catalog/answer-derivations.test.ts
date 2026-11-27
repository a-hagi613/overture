import { describe, expect, test } from "bun:test";

import type { DerivationFact, DerivationInput } from "./answer-derivations.ts";

import { emptyTargets } from "../../shared/targets.ts";
import { deriveAnswer } from "./answer-derivations.ts";
import { mapQuestionByRules } from "./question-rules.ts";

const canadianProfile = {
  ...emptyTargets,
  locations: ["city:ca:toronto", "country:us", "country:gb", "country:de", "country:au"],
};

const torontoFacts = new Map<string, DerivationFact>([
  ["current_city", { value: "Toronto", confirmed: true }],
  ["current_country", { value: "Canada", confirmed: true }],
  ["willing_relocate", { value: "Yes", confirmed: true }],
  ["current_employer", { value: "Brightwave Analytics", confirmed: true }],
  ["employment_history", { value: "Brightwave Analytics, 2020-2024", confirmed: true }],
]);

function input(overrides: Partial<DerivationInput>) {
  return {
    questionText: "",
    fieldType: "select",
    options: ["Yes", "No"],
    targets: canadianProfile,
    posting: {
      companyName: "Stripe",
      countryCode: "US",
      city: "San Francisco",
      region: "California",
      locationRaw: "San Francisco, CA",
    },
    facts: torontoFacts,
    ...overrides,
  } satisfies DerivationInput;
}

describe("target countries", () => {
  const options = ["Australia", "Canada", "Germany", "UK", "US"];

  test("answers the posting's country when Targets cover it", () => {
    expect(
      deriveAnswer(
        "target_countries",
        input({
          fieldType: "multiselect",
          options,
          questionText:
            "Please select the country or countries you anticipate working in for the role in which you are applying.",
        }),
      ),
    ).toBe("US");
  });

  test("answers every target country when the posting names none", () => {
    expect(
      deriveAnswer(
        "target_countries",
        input({
          fieldType: "multiselect",
          options,
          posting: {
            companyName: "Cloudflare",
            countryCode: null,
            city: null,
            region: null,
            locationRaw: "Hybrid",
          },
        }),
      ),
    ).toBe("Australia, Canada, Germany, UK, US");
  });

  test("does not answer without a target location", () => {
    expect(
      deriveAnswer(
        "target_countries",
        input({ fieldType: "multiselect", options, targets: emptyTargets }),
      ),
    ).toBeNull();
  });

  test("does not answer when the option list lacks the target country", () => {
    expect(
      deriveAnswer("target_countries", input({ fieldType: "multiselect", options: ["France"] })),
    ).toBeNull();
  });
});

describe("relocation", () => {
  const options = [
    "I currently live in this job's location.",
    "I am willing to relocate to this job's location.",
    "I do not live and not willing to relocate to this job's location.",
  ];

  const question =
    "This role requires that you live in one of the following hubs: Austin, TX or NYC. Are you currently located in one of the hub locations or willing to relocate?";

  test("answers that the user already lives there when the question names their city", () => {
    expect(
      deriveAnswer(
        "target_relocation",
        input({
          options,
          questionText:
            "This role requires that you live in one of the following hubs: Toronto, ON.",
        }),
      ),
    ).toBe("I currently live in this job's location.");
  });

  test("answers willing when the Fact says so", () => {
    expect(deriveAnswer("target_relocation", input({ options, questionText: question }))).toBe(
      "I am willing to relocate to this job's location.",
    );
  });

  test("answers not willing when the Fact says so", () => {
    expect(
      deriveAnswer(
        "target_relocation",
        input({
          options,
          questionText: question,
          facts: new Map([...torontoFacts, ["willing_relocate", { value: "No", confirmed: true }]]),
        }),
      ),
    ).toBe("I do not live and not willing to relocate to this job's location.");
  });

  test("does not answer without the willing-to-relocate Fact", () => {
    const facts = new Map(torontoFacts);

    facts.delete("willing_relocate");

    expect(
      deriveAnswer("target_relocation", input({ options, questionText: question, facts })),
    ).toBeNull();
  });
});

describe("employed by the company", () => {
  const question = "Have you ever been employed by Stripe or a Stripe affiliate?";

  test("answers yes when the current employer is the company", () => {
    expect(
      deriveAnswer(
        "employed_by_company",
        input({
          questionText: question,
          posting: { ...input({}).posting, companyName: "Brightwave Analytics" },
        }),
      ),
    ).toBe("Yes");
  });

  test("answers yes when the employment history names the company", () => {
    expect(
      deriveAnswer(
        "employed_by_company",
        input({
          questionText: question,
          facts: new Map([
            ...torontoFacts,
            ["employment_history", { value: "Northwind Labs, then Stripe", confirmed: true }],
          ]),
        }),
      ),
    ).toBe("Yes");
  });

  test("answers no from a confirmed history that does not name the company", () => {
    expect(deriveAnswer("employed_by_company", input({ questionText: question }))).toBe("No");
  });

  test("does not answer from an unconfirmed history", () => {
    expect(
      deriveAnswer(
        "employed_by_company",
        input({
          questionText: question,
          facts: new Map([
            ...torontoFacts,
            ["employment_history", { value: "Northwind Labs", confirmed: false }],
          ]),
        }),
      ),
    ).toBeNull();
  });

  test("does not answer without an employment history", () => {
    const facts = new Map(torontoFacts);

    facts.delete("employment_history");
    facts.delete("current_employer");

    expect(
      deriveAnswer("employed_by_company", input({ questionText: question, facts })),
    ).toBeNull();
  });
});

describe("US state list", () => {
  const question =
    "Do you live in one of the following states? Alabama, Alaska, Delaware, Kansas, Maine, Mississippi, Montana, Nebraska, New Mexico, North Dakota, South Dakota, West Virginia, or Wyoming.";

  test("answers no when the user lives outside the US", () => {
    expect(deriveAnswer("us_state_residence", input({ questionText: question }))).toBe("No");
  });

  test("answers yes when the user's state is listed", () => {
    expect(
      deriveAnswer(
        "us_state_residence",
        input({
          questionText: question,
          facts: new Map([
            ["current_city", { value: "Portland, ME", confirmed: true }],
            ["current_country", { value: "United States", confirmed: true }],
          ]),
        }),
      ),
    ).toBe("Yes");
  });

  test("answers no when the user's state is not listed", () => {
    expect(
      deriveAnswer(
        "us_state_residence",
        input({
          questionText: question,
          facts: new Map([
            ["current_city", { value: "Austin, TX", confirmed: true }],
            ["current_country", { value: "United States", confirmed: true }],
          ]),
        }),
      ),
    ).toBe("No");
  });

  test("does not read Virginia out of West Virginia", () => {
    expect(
      deriveAnswer(
        "us_state_residence",
        input({
          questionText: question,
          facts: new Map([
            ["current_city", { value: "Richmond, VA", confirmed: true }],
            ["current_country", { value: "United States", confirmed: true }],
          ]),
        }),
      ),
    ).toBe("No");
  });

  test("does not answer when the country is unknown", () => {
    expect(
      deriveAnswer(
        "us_state_residence",
        input({
          questionText: question,
          facts: new Map([["current_city", { value: "Northwind Bay", confirmed: true }]]),
        }),
      ),
    ).toBeNull();
  });
});

describe("current place", () => {
  test("combines city and region for a city-and-state field", () => {
    expect(
      deriveAnswer(
        "city_region",
        input({
          fieldType: "text",
          options: [],
          questionText: "If located in the US, in what city and state do you reside?",
        }),
      ),
    ).toBe("Toronto, Ontario");
  });

  test("combines city, region and country for a city-state-country field", () => {
    expect(
      deriveAnswer(
        "city_region_country",
        input({
          fieldType: "text",
          options: [],
          questionText: "Please indicate your current city, state, and country.",
        }),
      ),
    ).toBe("Toronto, Ontario, Canada");
  });

  test("does not answer without a city Fact", () => {
    const facts = new Map(torontoFacts);

    facts.delete("current_city");

    expect(
      deriveAnswer("city_region_country", input({ fieldType: "text", options: [], facts })),
    ).toBeNull();
  });
});

describe("question rules for derivations", () => {
  test("maps each recorded family to its derivation", () => {
    expect(
      mapQuestionByRules(
        "Please select the country or countries you anticipate working in for the role in which you are applying.",
      ),
    ).toEqual({ answerKind: "target", factKey: "target_countries" });

    expect(
      mapQuestionByRules(
        "This role requires that you live in one of the following hubs: Austin, TX or NYC. Are you currently located in one of the hub locations or willing to relocate?",
      ),
    ).toEqual({ answerKind: "target", factKey: "target_relocation" });

    expect(
      mapQuestionByRules("Have you ever been employed by Stripe or a Stripe affiliate?"),
    ).toEqual({ answerKind: "derived", factKey: "employed_by_company" });

    expect(
      mapQuestionByRules(
        "Do you live in one of the following states? Alabama, Alaska, Delaware, Kansas, Maine, Mississippi, Montana, Nebraska, New Mexico, North Dakota, South Dakota, West Virginia, or Wyoming.",
      ),
    ).toEqual({ answerKind: "derived", factKey: "us_state_residence" });

    expect(
      mapQuestionByRules("If located in the US, in what city and state do you reside?"),
    ).toEqual({ answerKind: "derived", factKey: "city_region" });

    expect(mapQuestionByRules("Please indicate your current city, state, and country.")).toEqual({
      answerKind: "derived",
      factKey: "city_region_country",
    });
  });

  test("maps the legal-name field to the saved legal name", () => {
    expect(mapQuestionByRules("Legal Name (if different than above)")).toEqual({
      answerKind: "fact",
      factKey: "legal_name",
    });
  });

  test("maps the onboarding job-title and how-you-heard questions to their Facts", () => {
    expect(mapQuestionByRules("What is your current or previous job title?")).toEqual({
      answerKind: "fact",
      factKey: "current_job_title",
    });

    expect(mapQuestionByRules("Current job title")).toEqual({
      answerKind: "fact",
      factKey: "current_job_title",
    });

    expect(mapQuestionByRules("How did you hear about us?")).toEqual({
      answerKind: "fact",
      factKey: "how_did_you_hear",
    });

    expect(mapQuestionByRules("Where did you first hear about this role?")).toEqual({
      answerKind: "fact",
      factKey: "how_did_you_hear",
    });

    expect(
      mapQuestionByRules("What is the title of the position you are applying for?"),
    ).toBeNull();
  });
});
