import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "playwright-core";

import { chromium } from "playwright-core";
import { z } from "zod";

import type { FactRecord } from "../src/server/profile/facts.ts";
import type { FormQuestion } from "../src/server/pipeline/send-plan.ts";
import type { Targets } from "../src/shared/targets.ts";

import { resolveLocation } from "../src/server/catalog/geo.ts";
import {
  normalizeFieldType,
  normalizeQuestionText,
} from "../src/server/catalog/question-normalize.ts";
import { mapQuestionByRules } from "../src/server/catalog/question-rules.ts";
import { readAshbyQuestions } from "../src/server/dispatch/ats/ashby.ts";
import { readLeverQuestions } from "../src/server/dispatch/ats/lever.ts";
import { indexFacts, resolveQuestion } from "../src/server/pipeline/answer-plan.ts";

const FIXTURES = join(process.cwd(), "test/e2e/fixtures");

type Ats = "greenhouse" | "lever" | "ashby";

const RECORDED_POSTINGS = { ashby: 12, greenhouse: 12, lever: 12 } satisfies Record<Ats, number>;

const HARSH_BLOCKS = new Set([
  "open_text_ungrounded",
  "unsupported_field",
  "non_standard_consent",
  "file_unavailable",
]);

function fact(key: string, value: string, scope = "") {
  return { key, value, scope, source: "user", confirmed: true, revision: 1 } satisfies FactRecord;
}

const facts: FactRecord[] = [
  fact("legal_name", "Maya Okafor"),
  fact("email", "maya.okafor@mail.overture.test"),
  fact("phone", "+1 416 555 0199"),
  fact("current_city", "Toronto"),
  fact("current_country", "Canada"),
  fact("linkedin_url", "https://www.linkedin.com/in/maya-okafor"),
  fact("work_auth", "Citizen", "CA"),
  fact("work_auth", "No", "US"),
  fact("work_auth", "No", "DE"),
  fact("sponsorship_required", "No", "CA"),
  fact("sponsorship_required", "Yes", "US"),
  fact("sponsorship_required", "Yes", "DE"),
  fact("notice_period", "4 weeks"),
  fact("earliest_start", "2026-01-05"),
  fact("salary_expectation", "CAD 150000 per year"),
  fact("willing_relocate", "Yes"),
  fact("years_total", "8"),
  fact("degree_highest", "Bachelor's degree"),
  fact("employment_history", "Northwind Labs (2020-2026); Acme Corp (2015-2020)"),
  fact("education_history", "BSc Computer Science, University of Toronto (2015)"),
  fact("current_employer", "Northwind Labs"),
  fact("languages", "English, French"),
];

const targets: Targets = {
  roles: ["Software Engineer"],
  locations: ["city:ca:toronto", "city:ca:vancouver", "city:de:berlin"],
  unresolvedLocations: [],
  unresolvedRoles: [],
};

interface Fixture {
  ats: Ats;
  board: string;
  file: string;
  place?: string;
  partial?: boolean;
}

const FORMS: readonly Fixture[] = [
  {
    ats: "lever",
    board: "levelup",
    file: "forms/lever/levelup-43782e4f-d8c4-4b16-b7ea-9f098bff279a.fixture.html",
  },
  {
    ats: "lever",
    board: "levelup",
    file: "forms/lever/levelup-3d887a86-647b-43f7-b4e5-7ea6d7031250.fixture.html",
  },
  {
    ats: "lever",
    board: "levelup",
    file: "forms/lever/levelup-fcae827c-13f9-41eb-b9ac-7ca18cac1e14.fixture.html",
  },
  {
    ats: "lever",
    board: "levelup",
    file: "forms/lever/levelup-c5beb51c-4d3b-49cd-88ff-ec21f0e7d8c3.fixture.html",
  },
  {
    ats: "lever",
    board: "offchainlabs",
    file: "forms/lever/offchainlabs-ea44f500-981b-4d7e-9203-3ada1dc12365.fixture.html",
  },
  {
    ats: "lever",
    board: "offchainlabs",
    file: "forms/lever/offchainlabs-52c01c91-582c-42fc-8722-82c3eeb9ed24.fixture.html",
  },
  {
    ats: "lever",
    board: "hive",
    file: "forms/lever/hive-ac502675-09a8-4169-8061-8d49fd4e2c4f.fixture.html",
  },
  {
    ats: "lever",
    board: "hive",
    file: "forms/lever/hive-46a2b956-a8e4-4b91-a404-08121e10bb62.fixture.html",
  },
  {
    ats: "lever",
    board: "hive",
    file: "forms/lever/hive-f00ef9bf-f943-495e-8936-e8cedb53ee46.fixture.html",
  },
  {
    ats: "ashby",
    board: "clera",
    file: "forms/ashby/clera-0a278229-474e-4534-82d0-ebfafe18ad9d.fixture.html",
  },
  {
    ats: "ashby",
    board: "highlightta",
    file: "forms/ashby/highlightta-1e4f70e2-9d0a-455e-9b08-e84b301e37e6.fixture.html",
  },
  {
    ats: "ashby",
    board: "highlightta",
    file: "forms/ashby/highlightta-9aa241a9-9022-45d0-9cf0-cacb92a34b35.fixture.html",
  },
  {
    ats: "ashby",
    board: "highlightta",
    file: "forms/ashby/highlightta-b73b0cf3-adef-4d4c-8fb6-bcaafc6d1c58.fixture.html",
  },
  {
    ats: "ashby",
    board: "highlightta",
    file: "forms/ashby/highlightta-e8617085-d61c-4b0e-9048-43dccd943ec9.fixture.html",
  },
  {
    ats: "ashby",
    board: "livinghr",
    file: "forms/ashby/livinghr-541dd4f5-2dd1-4cb0-8649-1f087ba762ec.fixture.html",
  },
  {
    ats: "ashby",
    board: "livinghr",
    file: "forms/ashby/livinghr-80f323d4-2be8-47a9-9f65-cf808feedeff.fixture.html",
  },
  {
    ats: "ashby",
    board: "livinghr",
    partial: true,
    file: "forms/ashby/livinghr-3921744c-b343-402d-858f-58a1edb21002.fixture.html",
  },
  {
    ats: "greenhouse",
    board: "cloudflare",
    place: "Hybrid",
    file: "greenhouse/cloudflare/jobs/7695702.questions.json",
  },
  {
    ats: "greenhouse",
    board: "cloudflare",
    place: "Hybrid",
    file: "greenhouse/cloudflare/jobs/8097321.questions.json",
  },
  {
    ats: "greenhouse",
    board: "cloudflare",
    place: "Hybrid",
    file: "greenhouse/cloudflare/jobs/8287256.questions.json",
  },
  {
    ats: "greenhouse",
    board: "cloudflare",
    place: "Hybrid",
    file: "greenhouse/cloudflare/jobs/8392878.questions.json",
  },
  {
    ats: "greenhouse",
    board: "stripe",
    place: "San Francisco, CA",
    file: "greenhouse/stripe/jobs/8138044.questions.json",
  },
  {
    ats: "greenhouse",
    board: "stripe",
    place: "Seattle, San Francisco, New York City",
    file: "greenhouse/stripe/jobs/8172510.questions.json",
  },
  {
    ats: "greenhouse",
    board: "stripe",
    place: "San Francisco",
    file: "greenhouse/stripe/jobs/8238731.questions.json",
  },
  {
    ats: "greenhouse",
    board: "stripe",
    place: "San Francisco, CA",
    file: "greenhouse/stripe/jobs/8332467.questions.json",
  },
  {
    ats: "greenhouse",
    board: "vercel",
    place: "Hybrid - Sydney",
    file: "greenhouse/vercel/jobs/5841911004.questions.json",
  },
  {
    ats: "greenhouse",
    board: "vercel",
    place: "Hybrid - London",
    file: "greenhouse/vercel/jobs/5999792004.questions.json",
  },
  {
    ats: "greenhouse",
    board: "vercel",
    place: "Hybrid - Sydney",
    file: "greenhouse/vercel/jobs/6100103004.questions.json",
  },
  {
    ats: "greenhouse",
    board: "vercel",
    place: "Remote - Germany",
    file: "greenhouse/vercel/jobs/6231864004.questions.json",
  },
];

const greenhouseQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      label: z.string(),
      required: z.boolean(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          values: z.array(z.object({ label: z.string() })),
        }),
      ),
    }),
  ),
});

interface Extracted {
  label: string;
  fieldType: string;
  required: boolean;
  options: string[];
}

interface Measured extends Extracted {
  answerKind: string;
  factKey: string | null;
  block: string | null;
  scope: string;
  review: boolean;
}

interface MeasuredForm extends Omit<Fixture, "file"> {
  file: string;
  place: string;
  questions: Measured[];
}

function greenhouseQuestions(file: string) {
  const parsed = greenhouseQuestionsSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, file), "utf8")),
  );

  return parsed.questions.map((question) => {
    const [first] = question.fields;
    const fileField = question.fields.some((field) => field.type === "input_file");

    return {
      fieldName: first?.name ?? "",
      fieldType: fileField ? "file" : normalizeFieldType(first?.type ?? "", first?.name ?? ""),
      label: question.label.replaceAll(/\s+/gu, " ").trim(),
      options: (first?.values ?? []).map((value) => value.label),
      required: question.required,
    };
  });
}

function measure(question: Extracted, board: string, place: string) {
  const mapping = mapQuestionByRules(question.label) ?? {
    answerKind: "unknown" as const,
    factKey: null,
  };

  const openText =
    mapping.answerKind === "open_text" &&
    (question.fieldType === "text" || question.fieldType === "textarea");

  if (openText) {
    return {
      ...question,
      answerKind: mapping.answerKind,
      factKey: mapping.factKey,
      block: question.required ? "open_text_ungrounded" : null,
      scope: "",
      review: false,
    };
  }

  const resolution = resolveQuestion({
    answerKind: mapping.answerKind,
    factKey: mapping.factKey,
    facts: indexFacts(facts),
    fieldType: normalizeFieldType(question.fieldType, ""),
    hasCoverLetter: false,
    hasResume: true,
    options: question.options,
    posting: {
      city: null,
      companyName: board,
      countryCode: resolveLocation(place).countryCode,
      locationRaw: place === "" ? null : place,
      region: null,
    },
    questionText: question.label,
    required: question.required,
    targets,
  });

  const block = resolution.kind === "blocked" ? resolution.reason : null;

  return {
    ...question,
    answerKind: mapping.answerKind,
    factKey: mapping.factKey,
    block,
    scope: resolution.kind === "blocked" ? resolution.scope : "",
    review: question.required && block !== null && !HARSH_BLOCKS.has(block),
  };
}

async function ashbyPlace(page: Page, ats: "lever" | "ashby") {
  return page.evaluate((site) => {
    if (site === "ashby") {
      for (const section of document.querySelectorAll<HTMLElement>(
        ".ashby-job-posting-left-pane > div",
      )) {
        const heading = (section.querySelector("h2")?.textContent ?? "")
          .replaceAll(/\s+/gu, " ")
          .trim();

        if (heading === "Location") {
          return (section.querySelector("p")?.textContent ?? "").replaceAll(/\s+/gu, " ").trim();
        }
      }

      return "";
    }

    return (document.querySelector(".posting-header .location")?.textContent ?? "")
      .replaceAll(/\s+/gu, " ")
      .trim();
  }, ats);
}

async function measureForm(browser: Awaited<ReturnType<typeof chromium.launch>>, fixture: Fixture) {
  let extracted: FormQuestion[];
  let place: string;

  if (fixture.ats === "greenhouse") {
    extracted = greenhouseQuestions(fixture.file);
    place = fixture.place ?? "";
  } else {
    const page = await browser.newPage();

    try {
      await page.setContent(readFileSync(join(FIXTURES, fixture.file), "utf8"), {
        waitUntil: "load",
      });
      extracted =
        fixture.ats === "lever" ? await readLeverQuestions(page) : await readAshbyQuestions(page);
      place = await ashbyPlace(page, fixture.ats);
    } finally {
      await page.close();
    }
  }

  const form = {
    ats: fixture.ats,
    board: fixture.board,
    file: fixture.file,
    place,
    questions: extracted.map((question) =>
      measure(
        {
          fieldType: question.fieldType,
          label: question.label,
          options: question.options,
          required: question.required,
        },
        fixture.board,
        place,
      ),
    ),
  } satisfies MeasuredForm;

  return fixture.partial === true ? { ...form, partial: true } : form;
}

function familyKey(question: Measured) {
  return `${normalizeQuestionText(question.label)}\u0000${question.scope}`;
}

function summarize(forms: readonly MeasuredForm[], ats: Ats) {
  const atsForms = forms.filter((form) => form.ats === ats && form.partial !== true);
  const partialForms = forms.filter((form) => form.ats === ats && form.partial === true);

  const blockedForms = atsForms.filter((form) =>
    form.questions.some((question) => question.block !== null),
  );

  const blocked = atsForms.flatMap((form) =>
    form.questions.filter((question) => question.block !== null),
  );

  const required = atsForms.flatMap((form) =>
    form.questions.filter((question) => question.required),
  );

  const families = new Map<
    string,
    { question: Measured; forms: number; instances: number; review: boolean }
  >();

  for (const form of atsForms) {
    const seen = new Set<string>();

    for (const question of form.questions) {
      if (question.block === null) {
        continue;
      }

      const key = familyKey(question);

      const family = families.get(key) ?? {
        instances: 0,
        forms: 0,
        question,
        review: question.review,
      };

      family.instances += 1;

      if (!seen.has(key)) {
        family.forms += 1;
        seen.add(key);
      }

      families.set(key, family);
    }
  }

  const postings = RECORDED_POSTINGS[ats] - partialForms.length;
  const everyFormBlocks = blockedForms.length === atsForms.length;

  const blockedPostings = everyFormBlocks
    ? `${String(postings)}/${String(postings)}`
    : `at least ${String(postings - (atsForms.length - blockedForms.length))}/${String(postings)}`;

  const reviews = [...families.values()].filter((family) => family.review);
  const distinct = new Set(required.map((question) => normalizeQuestionText(question.label)));

  return {
    ats,
    blocked,
    blockedPostings,
    blockedForms: blockedForms.length,
    distinct,
    families,
    forms: atsForms.length,
    partialForms,
    postings,
    required,
    reviews,
  };
}

function printSummary(forms: readonly MeasuredForm[]) {
  for (const ats of ["greenhouse", "lever", "ashby"] as const) {
    const summary = summarize(forms, ats);

    process.stdout.write(
      `\n## ${ats}: ${String(summary.forms)} forms over ${String(summary.postings)} postings; ${String(summary.required.length)} required questions (${String(summary.distinct.size)} distinct); ${String(summary.blockedForms)} forms blocked (${summary.blockedPostings} postings); ${String(summary.blocked.length)} blocked required instances; ${String(summary.reviews.length)} distinct Reviews\n`,
    );

    for (const form of summary.partialForms) {
      process.stdout.write(
        `(partial capture, excluded: ${form.file} — ${String(form.questions.length)} questions)\n`,
      );
    }

    for (const family of summary.families.values()) {
      process.stdout.write(
        `| ${String(family.forms)} form(s) / ${String(family.instances)} instance(s) | ${family.review ? "Review" : "hard stop"} | ${family.question.block ?? ""} | ${family.question.answerKind}${family.question.factKey === null ? "" : `:${family.question.factKey}`} | ${family.question.label.replaceAll(/\s+/gu, " ").slice(0, 160)} |\n`,
      );
    }
  }
}

function printDetail(forms: readonly MeasuredForm[]) {
  for (const form of forms) {
    process.stdout.write(`\n## ${form.ats} ${form.board} — ${form.file} (${form.place})\n`);

    for (const question of form.questions) {
      if (!question.required) {
        continue;
      }

      const verdict =
        question.block === null
          ? "ok"
          : `${question.block}${question.review ? " (review)" : " (hard stop)"}`;

      process.stdout.write(
        `- [${question.fieldType}] ${question.label} → ${question.answerKind}${question.factKey === null ? "" : `:${question.factKey}`} — ${verdict}\n`,
      );
    }
  }
}

const browser = await chromium.launch();

try {
  const forms = await Promise.all(FORMS.map(async (fixture) => measureForm(browser, fixture)));

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ forms }, null, 2)}\n`);
  } else {
    if (process.argv.includes("--detail")) {
      printDetail(forms);
    }

    printSummary(forms);
  }
} finally {
  await browser.close();
}
