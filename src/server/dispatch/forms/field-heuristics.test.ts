import { describe, expect, test } from "bun:test";

import { classifyFieldLabel, factKeyForFieldKind, foldFieldLabel } from "./field-heuristics.ts";
import { mapQuestionByRules } from "../../catalog/question-rules.ts";

describe("classifyFieldLabel", () => {
  test("reads English contact and application labels", () => {
    expect(classifyFieldLabel("First name")).toBe("first_name");
    expect(classifyFieldLabel("Last name")).toBe("last_name");
    expect(classifyFieldLabel("Full name")).toBe("full_name");
    expect(classifyFieldLabel("Email address")).toBe("email");
    expect(classifyFieldLabel("Mobile phone")).toBe("phone");
    expect(classifyFieldLabel("City")).toBe("location");
    expect(classifyFieldLabel("LinkedIn profile")).toBe("linkedin_url");
    expect(classifyFieldLabel("GitHub")).toBe("github_url");
    expect(classifyFieldLabel("Portfolio website")).toBe("website_url");
    expect(classifyFieldLabel("Are you authorized to work here?")).toBe("work_auth");
    expect(classifyFieldLabel("Will you require visa sponsorship?")).toBe("sponsorship_required");
    expect(classifyFieldLabel("Expected salary")).toBe("salary_expectation");
    expect(classifyFieldLabel("Years of experience")).toBe("years_total");
  });

  test("reads German, French and Spanish labels the English rules miss", () => {
    expect(classifyFieldLabel("Vorname")).toBe("first_name");
    expect(classifyFieldLabel("Nachname")).toBe("last_name");
    expect(classifyFieldLabel("Prénom")).toBe("first_name");
    expect(classifyFieldLabel("Nom de famille")).toBe("last_name");
    expect(classifyFieldLabel("Correo electrónico")).toBe("email");
    expect(classifyFieldLabel("Téléphone")).toBe("phone");
    expect(classifyFieldLabel("Gehaltsvorstellung")).toBe("salary_expectation");
    expect(classifyFieldLabel("Berufserfahrung")).toBe("years_total");
    expect(classifyFieldLabel("Arbeitsberechtigung")).toBe("work_auth");
    expect(classifyFieldLabel("Wohnort")).toBe("location");
    expect(classifyFieldLabel("Salario esperado")).toBe("salary_expectation");
  });

  test("reads Japanese labels, including the ones whose nouns overlap", () => {
    expect(classifyFieldLabel("氏名")).toBe("full_name");
    expect(classifyFieldLabel("姓")).toBe("last_name");
    expect(classifyFieldLabel("名前")).toBe("first_name");
    expect(classifyFieldLabel("電話番号")).toBe("phone");
    expect(classifyFieldLabel("メールアドレス")).toBe("email");
    expect(classifyFieldLabel("経験年数")).toBe("years_total");
    expect(classifyFieldLabel("給与")).toBe("salary_expectation");
  });

  test("returns null rather than guessing", () => {
    expect(classifyFieldLabel("Tell us about a project you're proud of")).toBeNull();
    expect(classifyFieldLabel("")).toBeNull();
  });

  test("folds accents and punctuation the way the label tables expect", () => {
    expect(foldFieldLabel("  Prénom (obligatoire) ")).toBe("prenom obligatoire");
    expect(foldFieldLabel("Correo Electrónico")).toBe("correo electronico");
  });
});

describe("factKeyForFieldKind", () => {
  test("maps each kind onto the Fact that answers it", () => {
    expect(factKeyForFieldKind("first_name")).toBe("legal_name");
    expect(factKeyForFieldKind("email")).toBe("email");
    expect(factKeyForFieldKind("location")).toBe("current_city");
    expect(factKeyForFieldKind("salary_expectation")).toBe("salary_expectation");
    expect(factKeyForFieldKind("years_total")).toBe("years_total");
  });
});

describe("the multilingual fallback in mapQuestionByRules", () => {
  test("answers a German name field that the English rules leave unmapped", () => {
    expect(mapQuestionByRules("Vorname")).toEqual({ answerKind: "fact", factKey: "legal_name" });
    expect(mapQuestionByRules("Berufserfahrung")).toEqual({
      answerKind: "fact",
      factKey: "years_total",
    });
    expect(mapQuestionByRules("Arbeitsberechtigung")).toEqual({
      answerKind: "fact",
      factKey: "work_auth",
    });
  });

  test("still leaves open text and unknown questions alone", () => {
    expect(mapQuestionByRules("Why do you want to work here?")).toEqual({
      answerKind: "open_text",
      factKey: null,
    });

    expect(mapQuestionByRules("Anything else we should know?")).toBeNull();
  });
});
