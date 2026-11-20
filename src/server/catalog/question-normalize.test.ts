import { describe, expect, test } from "bun:test";

import {
  affirmativeOption,
  matchOption,
  normalizeFieldType,
  normalizeOptionText,
  normalizeQuestionText,
  questionOptionsHash,
  questionVariantHash,
  reviewCategory,
} from "./question-normalize.ts";

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
  });
});

describe("matchOption", () => {
  test("matches ignoring case and punctuation", () => {
    expect(matchOption("yes", ["No", "Yes"])).toBe("Yes");
  });

  test("maps a stored affirmative to a yes option", () => {
    expect(matchOption("Canadian citizen", ["No", "Yes"])).toBe("Yes");
    expect(matchOption("I will require sponsorship", ["No", "Yes"])).toBe("No");
  });

  test("returns nothing when the value is not an option", () => {
    expect(matchOption("Toronto", ["Vancouver", "Montreal"])).toBeNull();
  });

  test("finds the affirmative option", () => {
    expect(affirmativeOption(["Disagree", "I agree"])).toBe("I agree");
    expect(affirmativeOption(["No", "Yes"])).toBe("Yes");
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
