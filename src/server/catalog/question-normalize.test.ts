import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  affirmativeOption,
  countriesNamedIn,
  matchOption,
  normalizeFieldType,
  normalizeOptionText,
  normalizeQuestionText,
  questionOptionsHash,
  questionVariantHash,
  referencesUserCountry,
  reviewCategory,
} from "./question-normalize.ts";

const recordedFixtureSchema = z.object({
  questions: z.array(
    z.object({
      label: z.string(),
      fields: z.array(
        z.object({
          values: z.array(z.object({ label: z.string() })).default([]),
        }),
      ),
    }),
  ),
});

function recordedOptions(file: string, labelStartsWith: string) {
  const path = new URL(`../../../test/e2e/fixtures/greenhouse/${file}`, import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

  const question = recordedFixtureSchema
    .parse(parsed)
    .questions.find((candidate) => candidate.label.startsWith(labelStartsWith));

  if (question === undefined) {
    throw new Error(`the recording has no question starting with ${labelStartsWith}`);
  }

  return question.fields.flatMap((field) => field.values.map((value) => value.label));
}

describe("normalizeQuestionText", () => {
  test("folds case, punctuation, numbers and spacing", () => {
    expect(normalizeQuestionText("  HOW many years' experience, exactly?  ")).toBe(
      "how many years experience exactly",
    );
  });

  test("strips the employer's name so the catalog is shared across companies", () => {
    expect(
      normalizeQuestionText("Why do you want to work at Northwind Labs?", ["Northwind Labs"]),
    ).toBe("why do you want to work at");

    expect(normalizeQuestionText("Why do you want to work at Ferro Cloud?", ["Ferro Cloud"])).toBe(
      "why do you want to work at",
    );
  });

  test("folds diacritics", () => {
    expect(normalizeQuestionText("¿Tienes autorización para trabajar?")).toBe(
      "tienes autorizacion para trabajar",
    );
  });

  test("removes numbers and links that vary between postings", () => {
    expect(
      normalizeQuestionText("Apply via https://example.com/123 or call 555-0100 about role 42"),
    ).toBe("apply via or call about role");
  });
});

describe("questionVariantHash", () => {
  test("is stable across employer names and punctuation", () => {
    const first = questionVariantHash("Are you authorized to work in Canada?", ["Northwind Labs"]);

    const second = questionVariantHash("are you authorized to work in canada", ["Ferro Cloud"]);

    expect(first).toBe(second);
  });

  test("differs when the question differs", () => {
    expect(questionVariantHash("Are you authorized to work?")).not.toBe(
      questionVariantHash("Will you require sponsorship?"),
    );
  });
});

describe("normalizeOptionText", () => {
  test("folds case and punctuation", () => {
    expect(normalizeOptionText("  Yes, I'm authorised. ")).toBe("yes i m authorised");
  });
});

describe("questionOptionsHash", () => {
  test("ignores option order and casing", () => {
    expect(questionOptionsHash(["Yes", "No"])).toBe(questionOptionsHash(["no", "YES"]));
  });

  test("changes with the options", () => {
    expect(questionOptionsHash(["Yes", "No"])).not.toBe(questionOptionsHash(["Yes"]));
  });
});

describe("normalizeFieldType", () => {
  test("maps Greenhouse field types", () => {
    expect(normalizeFieldType("input_text", "question_1")).toBe("text");
    expect(normalizeFieldType("textarea", "question_2")).toBe("textarea");
    expect(normalizeFieldType("multi_value_single_select", "question_3")).toBe("select");
    expect(normalizeFieldType("multi_value_multi_select", "question_4")).toBe("multiselect");
    expect(normalizeFieldType("input_file", "resume")).toBe("file");
    expect(normalizeFieldType("boolean", "question_5")).toBe("checkbox");
    expect(normalizeFieldType("date", "question_6")).toBe("date");
  });

  test("uses the field name when it is more specific", () => {
    expect(normalizeFieldType("input_text", "email")).toBe("email");
    expect(normalizeFieldType("input_text", "phone_number")).toBe("phone");
    expect(normalizeFieldType("input_text", "portfolio_url")).toBe("url");
    expect(normalizeFieldType("multi_value_single_select", "candidate_location")).toBe("select");
    expect(normalizeFieldType("input_text", "start_date")).toBe("date");
  });
});

describe("matchOption", () => {
  test("matches ignoring case and punctuation", () => {
    expect(matchOption("yes", ["No", "Yes"])).toEqual({ matched: true, option: "Yes" });
  });

  test("maps a stored affirmative to a yes option", () => {
    expect(matchOption("Canadian citizen", ["No", "Yes"])).toEqual({
      matched: true,
      option: "Yes",
    });
    expect(matchOption("I will require sponsorship", ["No", "Yes"])).toEqual({
      matched: true,
      option: "No",
    });
  });

  test("returns a typed option_missing reason when no option matches", () => {
    expect(matchOption("Toronto", ["Vancouver", "Montreal"])).toEqual({
      matched: false,
      reason: "option_missing",
    });
  });

  test("finds the affirmative option", () => {
    expect(affirmativeOption(["Disagree", "I agree"])).toBe("I agree");
    expect(affirmativeOption(["No", "Yes"])).toBe("Yes");
  });

  test("maps a work-authorisation type onto the recorded five-option select", () => {
    const options = recordedOptions(
      "vercel/jobs/5999792004.questions.json",
      "Are you authorized to work in the UK?",
    );

    expect(matchOption("Citizen", options)).toEqual({
      matched: true,
      option: "I am authorized to work in the country due to my nationality",
    });
    expect(matchOption("Work permit with no company sponsorship", options)).toEqual({
      matched: true,
      option:
        "I am authorized to work in the country based on a valid work permit and do not need a company to sponsor my visa",
    });
    expect(matchOption("Work permit that needs company sponsorship", options)).toEqual({
      matched: true,
      option:
        "I am authorized to work in the country based on a valid work permit which needs to be sponsored by the company I work for",
    });
    expect(matchOption("Not authorized to work and need visa support", options)).toEqual({
      matched: true,
      option: "I am not authorized to work in the country and need visa support",
    });
    expect(matchOption("Permanent resident", options)).toEqual({
      matched: false,
      reason: "option_missing",
    });
    expect(matchOption("Yes", options)).toEqual({ matched: false, reason: "option_missing" });
  });

  test("maps country names onto the recorded country selects", () => {
    const stripe = recordedOptions(
      "stripe/jobs/8138044.questions.json",
      "Please select the country where you currently reside.",
    );

    expect(matchOption("United States", stripe)).toEqual({ matched: true, option: "US" });
    expect(matchOption("USA", stripe)).toEqual({ matched: true, option: "US" });
    expect(matchOption("U.S.", stripe)).toEqual({ matched: true, option: "US" });
    expect(matchOption("United Kingdom", stripe)).toEqual({ matched: true, option: "UK" });
    expect(matchOption("Britain", stripe)).toEqual({ matched: true, option: "UK" });
    expect(matchOption("Netherlands", stripe)).toEqual({
      matched: true,
      option: "The Netherlands",
    });
    expect(matchOption("United Arab Emirates", stripe)).toEqual({ matched: true, option: "UAE" });
    expect(matchOption("Atlantis", stripe)).toEqual({
      matched: false,
      reason: "option_missing",
    });

    const vercel = recordedOptions(
      "vercel/jobs/5999792004.questions.json",
      "Are you currently based in any of these countries?",
    );

    expect(matchOption("USA", vercel)).toEqual({
      matched: true,
      option: "United States",
    });
    expect(matchOption("UK", vercel)).toEqual({ matched: true, option: "United Kingdom" });
    expect(matchOption("Netherlands", vercel)).toEqual({
      matched: false,
      reason: "option_missing",
    });
  });

  test("maps degrees, notice periods and salary periods from their tables", () => {
    const degrees = [
      "High School Diploma",
      "Associate's Degree",
      "Bachelor's Degree",
      "Master's Degree",
      "PhD",
      "Other",
    ];

    expect(matchOption("BSc", degrees)).toEqual({ matched: true, option: "Bachelor's Degree" });
    expect(matchOption("Master of Science", degrees)).toEqual({
      matched: true,
      option: "Master's Degree",
    });
    expect(matchOption("Doctor of Philosophy", degrees)).toEqual({ matched: true, option: "PhD" });
    expect(matchOption("Some college", degrees)).toEqual({
      matched: false,
      reason: "option_missing",
    });

    const notice = ["Immediately", "2 weeks", "4 weeks", "More than 3 months"];

    expect(matchOption("Four weeks", notice)).toEqual({ matched: true, option: "4 weeks" });
    expect(matchOption("3 days", notice)).toEqual({ matched: false, reason: "option_missing" });
    expect(matchOption("one month", notice)).toEqual({
      matched: false,
      reason: "option_missing",
    });

    const periods = ["Monthly", "Annual", "Hourly"];

    expect(matchOption("per year", periods)).toEqual({ matched: true, option: "Annual" });
    expect(matchOption("$150,000 per annum", periods)).toEqual({
      matched: true,
      option: "Annual",
    });
    expect(matchOption("yearly", periods)).toEqual({ matched: true, option: "Annual" });
    expect(matchOption("per week", periods)).toEqual({
      matched: false,
      reason: "option_missing",
    });
  });
});

describe("countriesNamedIn", () => {
  test("names the country a question asks about", () => {
    expect(countriesNamedIn("Are you authorized to work in the UK?")).toEqual(["GB"]);
    expect(countriesNamedIn("Are you authorized to work in Canada?")).toEqual(["CA"]);
    expect(countriesNamedIn("Can you work in the United States or Canada?")).toEqual(["CA", "US"]);
  });

  test("reads an uppercase two-letter country abbreviation", () => {
    expect(countriesNamedIn("Are you authorized to work in the US?")).toEqual(["US"]);
    expect(countriesNamedIn("Do you need a visa for the U.S.?")).toEqual(["US"]);
    expect(countriesNamedIn("Are you authorized to work in the U.K.?")).toEqual(["GB"]);
  });

  test("does not read a country out of an ordinary word", () => {
    expect(countriesNamedIn("Will you require us to sponsor a visa?")).toEqual([]);
    expect(countriesNamedIn("Do you need sponsorship now, or in the future?")).toEqual([]);
  });

  test("folds country aliases", () => {
    expect(countriesNamedIn("Are you based in England?")).toEqual(["GB"]);
    expect(countriesNamedIn("Do you live in the Netherlands?")).toEqual(["NL"]);
  });
});

describe("referencesUserCountry", () => {
  test("recognises questions about the country where the user lives", () => {
    expect(referencesUserCountry("Your authorization to work in the country where you live.")).toBe(
      true,
    );
    expect(
      referencesUserCountry(
        "Are you authorized to work in the location(s) you selected in your previous response?",
      ),
    ).toBe(true);
  });

  test("leaves a question about a named country alone", () => {
    expect(referencesUserCountry("Are you authorized to work in the UK?")).toBe(false);
  });
});

describe("reviewCategory", () => {
  test("groups by the mapped fact", () => {
    expect(reviewCategory("Anything", "years_total")).toBe("experience");
    expect(reviewCategory("Anything", "work_auth")).toBe("work_authorization");
    expect(reviewCategory("Anything", "website_url")).toBe("links");
    expect(reviewCategory("Anything", "languages")).toBe("languages");
    expect(reviewCategory("Anything", "eeo_veteran")).toBe("eeo");
  });

  test("reads an unmapped question's subject", () => {
    expect(reviewCategory("Are you comfortable with a weekly on-call rotation?", null)).toBe(
      "availability",
    );
    expect(reviewCategory("How many years have you run Kubernetes in production?", null)).toBe(
      "experience",
    );
    expect(reviewCategory("Security clearance status", null)).toBe("work_authorization");
    expect(reviewCategory("Link to your portfolio", null)).toBe("links");
  });

  test("falls back to other", () => {
    expect(reviewCategory("Favourite colour", null)).toBe("other");
  });
});
