import { afterEach, describe, expect, test } from "bun:test";

import type { FactRecord } from "../profile/facts.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";
import type { ApplyLink } from "../dispatch/forms/apply-link.ts";
import type { RuleMapping } from "../catalog/question-rules.ts";
import type { LlmPort } from "../platform/ports/llm.ts";

import { emptyTargets } from "../../shared/targets.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import { applications, mailboxes, profiles, resumes, users } from "../platform/db/schema.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { createFactService } from "../profile/facts.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { createQuestionCatalog } from "../catalog/questions.ts";
import { openReviewsForApplication } from "./review-store.ts";
import { readAshbyGraphqlResponse } from "./form-read.ts";
import { indexFacts, resolveQuestion } from "./answer-plan.ts";
import { mapIdentityFieldName, mapQuestionByRules } from "../catalog/question-rules.ts";
import { classifyFieldName } from "../dispatch/forms/field-heuristics.ts";
import { sameSystemApplyUrl } from "../dispatch/forms/apply-link.ts";

interface RecordedQuestion {
  label: string;
  fieldName: string;
  fieldType: QuestionFieldType;
  options: string[];
  required: boolean;
}

const posting = {
  city: "Toronto",
  companyName: "Kaseya",
  countryCode: "CA",
  locationRaw: "Toronto, Ontario, Canada",
  region: "Ontario",
};

function fact(key: string, value: string, confirmed = true) {
  return { confirmed, key, revision: 1, scope: "", source: "review", value } satisfies FactRecord;
}

const mayaFacts = [
  fact("legal_name", "Maya Chen"),
  fact("email", "maya.chen@fhwalk.test"),
  fact("phone", "613-555-0142"),
  fact("current_city", "Ottawa, ON, Canada"),
  fact("current_country", "Canada"),
  fact("current_employer", "Shopwise Commerce"),
  fact("current_job_title", "Senior Software Engineer"),
  fact("work_auth", "Canadian citizen"),
  fact("sponsorship_required", "No"),
  fact("notice_period", "30 days"),
  fact("languages", "English (native), Mandarin (fluent), French (intermediate)"),
  fact("linkedin_url", "https://linkedin.com/in/mayachen"),
  fact("salary_expectation", "CAD 140,000 a year"),
];

const KASEYA_QUESTIONS: readonly RecordedQuestion[] = [
  { fieldName: "first_name", fieldType: "text", label: "First Name", options: [], required: true },
  { fieldName: "last_name", fieldType: "text", label: "Last Name", options: [], required: true },
  { fieldName: "email", fieldType: "email", label: "Email", options: [], required: true },
  { fieldName: "phone", fieldType: "phone", label: "Phone", options: [], required: true },
  { fieldName: "resume", fieldType: "file", label: "Resume/CV", options: [], required: true },
  {
    fieldName: "cover_letter",
    fieldType: "file",
    label: "Cover Letter",
    options: [],
    required: false,
  },
  {
    fieldName: "question_20267275004",
    fieldType: "select",
    label: "What is your current country of residence?",
    options: [
      "United States",
      "Argentina",
      "Australia",
      "Brazil",
      "Canada",
      "Colombia",
      "Denmark",
      "Georgia",
      "Germany",
      "Guatemala",
      "India",
      "Ireland",
      "Israel",
      "Lithuania",
      "Mexico",
      "Netherlands",
      "New Zealand",
      "Philippines",
      "Poland",
      "Portugal",
      "Romania",
      "Slovakia",
      "Spain",
      "Sweden",
      "Ukraine",
      "United Kingdom",
      "Uruguay",
      "Other",
    ],
    required: true,
  },
  {
    fieldName: "question_20267276004",
    fieldType: "select",
    label: "Are you legally eligible to work in the country in which you are applying?",
    options: ["Yes", "No"],
    required: true,
  },
  {
    fieldName: "question_20267277004",
    fieldType: "select",
    label: "Do you now or will you at any time in the future require sponsorship?",
    options: ["Yes", "No"],
    required: true,
  },
  {
    fieldName: "question_20267278004",
    fieldType: "select",
    label: "Have you ever worked for Kaseya (as an employee, intern, or contractor)?",
    options: [
      "No, Never Employed by or at Kaseya",
      "Current Kaseya Employee",
      "Former Kaseya Employee",
      "Current Kaseya Intern",
      "Former Kaseya Intern",
      "Current Contractor / Consultant at Kaseya",
      "Former Contractor / Consultant at Kaseya",
    ],
    required: true,
  },
  {
    fieldName: "question_20267279004",
    fieldType: "text",
    label: "Who is your current or most recent employer?",
    options: [],
    required: true,
  },
  {
    fieldName: "question_20267280004",
    fieldType: "text",
    label: "What is your desired annual base salary and desired total compensation?",
    options: [],
    required: true,
  },
  {
    fieldName: "question_20267281004",
    fieldType: "select",
    label: "Which role category most closely matches your current or recent position?",
    options: [
      "Software Engineering & Development ",
      "IT, Infrastructure, DevOps & Cloud Operations ",
      "Artificial Intelligence & Machine Learning ",
      "Go-To-Market: Sales, Accounts & Biz Dev ",
      "Customer Support, Customer Success & Services ",
      "Product Management & Design",
      "Information Security, Risk & Compliance ",
      "Data, Analytics & Business Intelligence ",
      "Program & Project Management ",
      "Marketing & Communications ",
      "Operations, Admin, Supply Chain, & Workplace Support ",
      "Corporate Functions: Finance, Legal, HR & Talent ",
      "Other",
    ],
    required: true,
  },
  {
    fieldName: "question_20267282004",
    fieldType: "text",
    label: "LinkedIn Profile (N/A if not available)",
    options: [],
    required: true,
  },
  {
    fieldName: "question_20267283004",
    fieldType: "select",
    label:
      "** OPTIONAL TO INCLUDE ** --> This role requires working onsite at our _____ office _____ days per week. Are you able to meet this requirement?",
    options: ["Yes", "No"],
    required: true,
  },
  {
    fieldName: "question_20267284004",
    fieldType: "select",
    label:
      "** OPTIONAL TO INCLUDE ** --> Do you currently live in _____, or are you willing to relocate there?",
    options: [
      "I currently reside in the area.",
      "I live within a commutable distance.",
      "I am willing to relocate.",
      "I do not reside in or plan to relocate to the area.",
    ],
    required: true,
  },
  {
    fieldName: "question_20267285004",
    fieldType: "select",
    label:
      "** OPTIONAL TO INCLUDE ** --> What most closely describes the notice period required for your current role?",
    options: [
      "Available Immediately",
      "7 days",
      "15 days",
      "30 days",
      "45 days",
      "60 days",
      "90+ days",
    ],
    required: true,
  },
  {
    fieldName: "question_20267286004",
    fieldType: "select",
    label:
      "** OPTIONAL TO INCLUDE ** --> Do you have professional English fluency, including the ability to speak, write, and read English at a business level?",
    options: ["Yes", "No"],
    required: true,
  },
];

const JOBGETHER_QUESTIONS: readonly RecordedQuestion[] = [
  {
    fieldName: "name",
    fieldType: "text",
    label: "Full name",
    options: [],
    required: true,
  },
  {
    fieldName: "email",
    fieldType: "email",
    label: "Email",
    options: [],
    required: true,
  },
  {
    fieldName: "phone",
    fieldType: "phone",
    label: "Phone",
    options: [],
    required: false,
  },
  {
    fieldName: "location",
    fieldType: "text",
    label: "Current location",
    options: [],
    required: false,
  },
  {
    fieldName: "org",
    fieldType: "text",
    label: "Current company",
    options: [],
    required: false,
  },
];

const FORWARD_FINANCING_FORM = JSON.stringify({
  data: {
    jobPosting: {
      applicationForm: {
        sections: [
          {
            fieldEntries: [
              {
                field: { path: "_systemfield_name", title: "Name", type: "String" },
                isRequired: true,
              },
              {
                field: { path: "_systemfield_email", title: "Email", type: "Email" },
                isRequired: true,
              },
              {
                field: { path: "_systemfield_phone", title: "Phone", type: "Phone" },
                isRequired: false,
              },
              {
                field: { path: "_systemfield_resume", title: "Resume", type: "File" },
                isRequired: true,
              },
              {
                field: { path: "location", title: "Current location", type: "Location" },
                isRequired: false,
              },
              {
                field: { path: "company", title: "Current company", type: "String" },
                isRequired: false,
              },
              {
                field: { path: "linkedin", title: "LinkedIn Profile", type: "Url" },
                isRequired: false,
              },
              {
                field: {
                  path: "work_auth",
                  title:
                    "Are you legally eligible to work in the country in which you are applying?",
                  type: "Boolean",
                },
                isRequired: true,
              },
              {
                field: {
                  path: "sponsorship",
                  title: "Will you now or in the future require sponsorship?",
                  type: "Boolean",
                },
                isRequired: true,
              },
            ],
          },
        ],
      },
      surveyForms: [],
    },
  },
});

const UNKNOWN_MAPPING: RuleMapping = { answerKind: "unknown", factKey: null };

function mappingFor(question: RecordedQuestion) {
  return (
    mapQuestionByRules(question.label) ??
    mapIdentityFieldName(question.fieldName) ??
    UNKNOWN_MAPPING
  );
}

function withoutLabel(question: RecordedQuestion) {
  return {
    fieldName: question.fieldName,
    fieldType: question.fieldType,
    label: "",
    options: question.options,
    required: question.required,
  } satisfies RecordedQuestion;
}

function resolveRecorded(
  question: RecordedQuestion,
  facts: readonly FactRecord[],
  options: { required?: boolean } = {},
) {
  const mapping = mappingFor(question);

  return resolveQuestion({
    answerKind: mapping.answerKind,
    factKey: mapping.factKey,
    facts: indexFacts(facts),
    fieldType: question.fieldType,
    hasCoverLetter: false,
    hasResume: true,
    options: question.options,
    posting,
    questionText: question.label,
    required: options.required ?? question.required,
    targets: emptyTargets,
  });
}

function answeredValue(question: RecordedQuestion, facts: readonly FactRecord[]) {
  const resolution = resolveRecorded(question, facts);

  return resolution.kind === "answer" ? resolution.value : null;
}

function reviewCount(questions: readonly RecordedQuestion[], facts: readonly FactRecord[]) {
  return questions.filter((question) => resolveRecorded(question, facts).kind === "blocked").length;
}

describe("the 26 Nov recorded identity fields", () => {
  test("fills every Jobgether Lever identity field from Maya's confirmed facts", () => {
    expect(JOBGETHER_QUESTIONS.map((question) => answeredValue(question, mayaFacts))).toEqual([
      "Maya Chen",
      "maya.chen@fhwalk.test",
      "613-555-0142",
      "Ottawa, ON, Canada",
      "Shopwise Commerce",
    ]);
  });

  test("maps identity controls by field name when the label says nothing", () => {
    const unlabelled = JOBGETHER_QUESTIONS.map((question) => withoutLabel(question));

    expect(unlabelled.map((question) => mappingFor(question).factKey)).toEqual([
      "legal_name",
      "email",
      "phone",
      "current_city",
      "current_employer",
    ]);
  });

  test("unwraps a board's system-field and bracket names", () => {
    expect(classifyFieldName("_systemfield_name")).toBe("full_name");
    expect(classifyFieldName("_systemfield_email")).toBe("email");
    expect(classifyFieldName("candidate[first_name]")).toBe("first_name");
    expect(classifyFieldName("candidate[email]")).toBe("email");
    expect(classifyFieldName("org")).toBe("current_company");
  });

  test("fills every Kaseya Greenhouse identity field from the same facts", () => {
    const identityFields = KASEYA_QUESTIONS.filter((question) =>
      ["first_name", "last_name", "email", "phone"].includes(question.fieldName),
    );

    expect(identityFields.map((question) => answeredValue(question, mayaFacts))).toEqual([
      "Maya",
      "Chen",
      "maya.chen@fhwalk.test",
      "613-555-0142",
    ]);
  });

  test("fills every Forward Financing Ashby identity field from the recorded form", () => {
    const read = readAshbyGraphqlResponse(FORWARD_FINANCING_FORM);

    expect(read?.path).toBe("ashby_graphql");

    const identity = (read?.questions ?? []).filter((question) =>
      ["_systemfield_name", "_systemfield_email", "_systemfield_phone"].includes(
        question.fieldName,
      ),
    );

    expect(
      identity.map((question) =>
        answeredValue(
          {
            fieldName: question.fieldName,
            fieldType: question.fieldType,
            label: question.label,
            options: [...question.options],
            required: question.required,
          },
          mayaFacts,
        ),
      ),
    ).toEqual(["Maya Chen", "maya.chen@fhwalk.test", "613-555-0142"]);
  });

  test("answers the Ashby work-authorisation pair from citizenship and sponsorship", () => {
    const read = readAshbyGraphqlResponse(FORWARD_FINANCING_FORM);

    const answers = (read?.questions ?? []).flatMap((question) => {
      if (!["work_auth", "sponsorship"].includes(question.fieldName)) {
        return [];
      }

      return [
        answeredValue(
          {
            fieldName: question.fieldName,
            fieldType: question.fieldType,
            label: question.label,
            options: [...question.options],
            required: question.required,
          },
          mayaFacts,
        ),
      ];
    });

    expect(answers).toEqual(["Yes", "No"]);
  });
});

describe("the Kaseya template leftovers", () => {
  test("leaves the blank-placeholder questions empty instead of asking them", () => {
    const blanks = KASEYA_QUESTIONS.filter((question) => question.label.includes("_____"));

    expect(blanks).toHaveLength(2);

    for (const question of blanks) {
      expect(resolveRecorded(question, mayaFacts)).toMatchObject({
        kind: "blank",
        reason: "optional_unfilled",
      });
    }
  });

  test("keeps a real question that carries the same marker", () => {
    const notice = KASEYA_QUESTIONS.find((question) => question.label.includes("notice period"));
    const english = KASEYA_QUESTIONS.find((question) => question.label.includes("English fluency"));

    expect(notice === undefined ? null : answeredValue(notice, mayaFacts)).toBe("30 days");
    expect(english === undefined ? null : answeredValue(english, mayaFacts)).toBe("Yes");
  });

  test("stays under the four-question Review budget with Maya's confirmed facts", () => {
    expect(reviewCount(KASEYA_QUESTIONS, mayaFacts)).toBeLessThanOrEqual(4);
  });

  test("uses the current title to pick the role category", () => {
    const question = KASEYA_QUESTIONS.find((recorded) => recorded.label.includes("role category"));

    expect(question === undefined ? null : answeredValue(question, mayaFacts)).toBe(
      "Software Engineering & Development ",
    );
  });
});

describe("citizenship answers that follow the country", () => {
  const canada = {
    fieldName: "work_auth",
    fieldType: "select" as const,
    label: "Are you legally eligible to work in Canada?",
    options: ["Yes", "No"],
    required: true,
  };

  const unitedStates = {
    ...canada,
    label: "Are you legally eligible to work in the United States?",
  };

  test("answers Yes in the country the citizenship names", () => {
    expect(answeredValue(canada, mayaFacts)).toBe("Yes");
  });

  test("never claims authorisation in a country the citizenship does not name", () => {
    expect(answeredValue(unitedStates, mayaFacts)).toBeNull();
  });

  test("answers No to sponsorship from the confirmed citizenship alone", () => {
    const sponsorship = {
      fieldName: "sponsorship",
      fieldType: "select" as const,
      label: "Will you now or in the future require sponsorship?",
      options: ["Yes", "No"],
      required: true,
    };

    const citizenshipOnly = mayaFacts.filter((entry) => entry.key !== "sponsorship_required");

    expect(answeredValue(sponsorship, citizenshipOnly)).toBe("No");
  });

  test("never guesses when the work-authorisation fact is unconfirmed", () => {
    const unconfirmed = mayaFacts.map((entry) =>
      entry.key === "work_auth" || entry.key === "sponsorship_required"
        ? fact(entry.key, entry.value, false)
        : entry,
    );

    expect(answeredValue(canada, unconfirmed)).toBeNull();
  });
});

describe("the Jobgether apply link", () => {
  const jobUrl = "https://jobs.lever.co/jobgether/2eebef8d-a28d-4f1a-9593-61a508ffa134";

  const links: ApplyLink[] = [
    { href: "https://www.jobgether.com/privacy", text: "Privacy" },
    { href: "/jobgether/2eebef8d-a28d-4f1a-9593-61a508ffa134/apply", text: "APPLY FOR THIS JOB" },
  ];

  test("follows the one apply link on the same job path", () => {
    expect(sameSystemApplyUrl(jobUrl, links)).toBe(`${jobUrl}/apply`);
  });

  test("never leaves the job system or repeats a page already at its apply path", () => {
    expect(
      sameSystemApplyUrl("https://example.com/jobs/1", [
        { href: "https://other.example/apply", text: "Apply" },
      ]),
    ).toBeNull();

    expect(sameSystemApplyUrl(`${jobUrl}/apply`, links)).toBeNull();
  });

  test("ignores a link that neither names an apply path nor reads as one", () => {
    expect(sameSystemApplyUrl(jobUrl, [{ href: "/jobgether/about", text: "About us" }])).toBeNull();
  });

  test("never jumps to another job's application", () => {
    expect(
      sameSystemApplyUrl(jobUrl, [
        { href: "/jobgether/5a1f0c9e-0000-0000-0000-000000000000/apply", text: "Apply" },
      ]),
    ).toBeNull();
  });
});

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

Bun.env.BETTER_AUTH_SECRET ??= "app-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

const { createPreparationService } = await import("./prepare.ts");

const NOW = Date.UTC(2026, 10, 26, 20, 0);

interface RecordedForm {
  company: string;
  ats: "ashby" | "greenhouse" | "lever";
  countryCode: string;
  questions: readonly RecordedQuestion[];
}

const JOBGETHER_FORM: RecordedForm = {
  ats: "lever",
  company: "Jobgether",
  countryCode: "CA",
  questions: JOBGETHER_QUESTIONS,
};

const KASEYA_FORM: RecordedForm = {
  ats: "greenhouse",
  company: "Kaseya",
  countryCode: "CA",
  questions: KASEYA_QUESTIONS,
};

function ashbyRecordedQuestions() {
  const read = readAshbyGraphqlResponse(FORWARD_FINANCING_FORM);

  return (read?.questions ?? []).map((question) => ({
    fieldName: question.fieldName,
    fieldType: question.fieldType,
    label: question.label,
    options: [...question.options],
    required: question.required,
  })) satisfies RecordedQuestion[];
}

function fakeLlm() {
  const empty = {
    cachedTokens: 0,
    cacheWriteTokens: 0,
    costMicros: 0,
    inputTokens: 0,
    model: "fake",
    outputTokens: 0,
    text: null,
  };

  return {
    estimateBatchCostMicros: () => 0,
    estimateSingleCostMicros: () => 0,
    estimateStructuredCostMicros: () => 0,
    runBatch: async () => {
      await Promise.resolve();

      return [];
    },
    runSingle: async () => {
      await Promise.resolve();

      return empty;
    },
    runStructured: async () => {
      await Promise.resolve();

      return empty;
    },
  } satisfies LlmPort;
}

const openHandles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    handle.close();
  }
});

async function recordedFormStack(form: RecordedForm) {
  const app = openDatabase(":memory:");
  const catalog = openCatalogDatabase(":memory:");

  migrateDatabase(app.db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  openHandles.push(app.sqlite, catalog.sqlite);

  app.db
    .insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "maya@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Maya Chen",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();

  catalog.db
    .insert(companies)
    .values({
      createdAt: NOW,
      id: "company-1",
      name: form.company,
      nameNorm: form.company.toLowerCase(),
    })
    .run();

  catalog.db
    .insert(companyBoards)
    .values({
      ats: form.ats,
      boardToken: "board-1",
      companyId: "company-1",
      createdAt: NOW,
      id: "board-1",
      region: "us",
      source: "v1_seed",
    })
    .run();

  catalog.db
    .insert(postings)
    .values({
      applySupported: true,
      applyUrlNorm: "https://example.test/job-1",
      ats: form.ats,
      atsJobId: "job-1",
      boardId: "board-1",
      companyId: "company-1",
      countryCode: form.countryCode,
      dedupeKey: `${form.ats}:job-1`,
      firstSeenAt: NOW,
      id: "posting-1",
      lastSeenAt: NOW,
      questionsFetchedAt: NOW,
      title: "Senior Software Engineer",
      titleNorm: "senior software engineer",
      url: "https://example.test/job-1",
    })
    .run();

  app.db
    .insert(applications)
    .values({
      ats: form.ats,
      companyId: "company-1",
      companyName: form.company,
      companyNameNorm: form.company.toLowerCase(),
      createdAt: NOW,
      id: "application-1",
      origin: "auto",
      postingId: "posting-1",
      postingTitle: "Senior Software Engineer",
      postingUrl: "https://example.test/job-1",
      status: "preparing",
      updatedAt: NOW,
      userId: "user-1",
    })
    .run();

  const clock = createClock();
  const personal = createPersonalCrypto(app.db, masterKeyringFor(new Uint8Array(32).fill(5)));
  const facts = createFactService({ clock, db: app.db, personal });
  const questionCatalog = createQuestionCatalog({ catalogDb: catalog.db, clock, db: app.db });

  app.db
    .insert(profiles)
    .values({
      createdAt: new Date(NOW),
      timezone: "UTC",
      updatedAt: new Date(NOW),
      userId: "user-1",
    })
    .run();

  app.db
    .insert(mailboxes)
    .values({
      applyAddress: "maya.okafor.4k@tryoverture.com",
      createdAt: new Date(NOW),
      id: "mailbox-1",
      localPart: "maya.okafor.4k",
      userId: "user-1",
    })
    .run();

  const resumeText = "Maya Chen · Senior Software Engineer · Ottawa, ON, Canada";

  app.db
    .insert(resumes)
    .values({
      bytes: 1024,
      filenameEnc: await personal.sealFor(
        "user-1",
        { column: "filename_enc", rowId: "resume-1", table: "resumes" },
        "maya-chen.pdf",
      ),
      id: "resume-1",
      isCurrent: true,
      objectKey: "resumes/maya-chen.pdf",
      pages: 1,
      parsedWith: "unpdf",
      sha256: "0".repeat(64),
      textEnc: await personal.sealFor(
        "user-1",
        { column: "text_enc", rowId: "resume-1", table: "resumes" },
        resumeText,
      ),
      uploadedAt: new Date(NOW),
      userId: "user-1",
    })
    .run();

  const entries = form.questions.map((question, position) => {
    const record = questionCatalog.findOrCreate({
      companyNames: [form.company],
      fieldName: question.fieldName,
      fieldType: question.fieldType,
      options: question.options,
      text: question.label,
    });

    return {
      fieldName: question.fieldName,
      options: question.options,
      position,
      questionId: record.id,
      required: question.required,
    };
  });

  questionCatalog.savePostingQuestions("posting-1", entries);

  const preparation = createPreparationService({
    catalogDb: catalog.db,
    clock,
    db: app.db,
    llm: fakeLlm(),
    personal,
    source: null,
  });

  return { app: app.db, facts, preparation, userId: "user-1" };
}

async function preparedStack(form: RecordedForm) {
  const stack = await recordedFormStack(form);

  await Promise.all(
    mayaFacts.map(
      async (entry) => await stack.facts.save(stack.userId, entry.key, entry.value, entry.scope),
    ),
  );

  const result = await stack.preparation.prepare("application-1");

  return { ...stack, result };
}

async function planAnswers(stack: Awaited<ReturnType<typeof preparedStack>>) {
  const plan = await stack.preparation.sendPlanFor("application-1");

  return new Map((plan?.fields ?? []).map((field) => [field.label, field.answer]));
}

describe("the 26 Nov recorded forms through preparation", () => {
  test("fills every Jobgether identity field without any live call", async () => {
    const stack = await preparedStack(JOBGETHER_FORM);
    const answers = await planAnswers(stack);

    expect(answers.get("Full name")).toBe("Maya Chen");
    expect(answers.get("Email")).toBe("maya.okafor.4k@tryoverture.com");
    expect(answers.get("Phone")).toBe("613-555-0142");
    expect(answers.get("Current location")).toBe("Ottawa, ON, Canada");
    expect(answers.get("Current company")).toBe("Shopwise Commerce");
  });

  test("fills every Forward Financing identity field without any live call", async () => {
    const stack = await preparedStack({
      ats: "ashby",
      company: "Forward Financing",
      countryCode: "US",
      questions: ashbyRecordedQuestions(),
    });

    const answers = await planAnswers(stack);

    expect(answers.get("Name")).toBe("Maya Chen");
    expect(answers.get("Email")).toBe("maya.okafor.4k@tryoverture.com");
    expect(answers.get("Phone")).toBe("613-555-0142");
    expect(answers.get("Current location")).toBe("Ottawa, ON, Canada");
    expect(answers.get("Current company")).toBe("Shopwise Commerce");
  });

  test("keeps the Kaseya Review at four questions and never asks a blank template", async () => {
    const stack = await preparedStack(KASEYA_FORM);

    expect(stack.result).toMatchObject({ status: "needs_review" });

    const reviews = openReviewsForApplication(stack.app, stack.userId, "application-1");

    expect(reviews.length).toBeLessThanOrEqual(4);
    expect(reviews.some((review) => review.prompt.includes("_____"))).toBe(false);
  });

  test("leaves the Kaseya template leftovers empty in the send plan", async () => {
    const stack = await preparedStack(KASEYA_FORM);

    const prepared = await stack.preparation.answersFor("application-1");

    const template = prepared.filter((answer) => answer.text.includes("_____"));

    expect(template).toHaveLength(2);

    for (const answer of template) {
      expect(answer).toMatchObject({ block: "optional_unfilled", reason: null, resolved: false });
    }
  });
});
