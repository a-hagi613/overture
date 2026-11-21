import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { QuestionCatalog } from "../catalog/questions.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";
import type { V1AnswerEntry, V1Export, V1LearnedAnswer } from "./v1-export.ts";
import type { PersonalCrypto } from "./personal-crypto.ts";

import { normalizeQuestionText } from "../catalog/question-normalize.ts";
import { answerIsValid } from "../pipeline/answer-value.ts";
import { facts } from "../platform/db/schema.ts";

export type V1ImportSkipReason =
  | "no_catalog_key"
  | "unknown_question"
  | "invalid_value"
  | "kept_user_fact";

interface FactTarget {
  key: string;
  scope: string;
  merge?: boolean;
}

export interface V1ImportedFact {
  key: string;
  scope: string;
  from: string;
}

export interface V1SkippedFact {
  key: string | null;
  scope: string;
  from: string;
  reason: V1ImportSkipReason;
}

export interface V1NotImportedSection {
  section: string;
  rows: number;
}

export interface V1ImportReport {
  exported: {
    answerBankEntries: number;
    answerYears: number;
    achievements: number;
    aliases: number;
    settings: number;
    learnedAnswers: number;
  };
  counts: {
    imported: number;
    updated: number;
    unchanged: number;
    skipped: number;
  };
  questionMappings: number;
  imported: V1ImportedFact[];
  updated: V1ImportedFact[];
  unchanged: V1ImportedFact[];
  skipped: V1SkippedFact[];
  notImported: V1NotImportedSection[];
}

export type EntryMapping =
  | { kind: "fact"; key: string; scope: string; value: string; merge: boolean }
  | { kind: "skip"; reason: V1ImportSkipReason };

export type LearnedMapping =
  | {
      kind: "fact";
      key: string;
      scope: string;
      value: string;
      confirmed: boolean;
      questionId: string;
      needsMapping: boolean;
    }
  | { kind: "skip"; reason: V1ImportSkipReason };

const FACT_TARGETS_BY_KEY: ReadonlyMap<string, FactTarget> = new Map([
  ["legal_name", { key: "legal_name", scope: "" }],
  ["email", { key: "email", scope: "" }],
  ["email_on_application_forms", { key: "email", scope: "" }],
  ["email_on_applications", { key: "email", scope: "" }],
  ["preferred_first_name", { key: "preferred_name", scope: "" }],
  ["phone", { key: "phone", scope: "" }],
  ["current_city", { key: "current_city", scope: "" }],
  ["linkedin", { key: "linkedin_url", scope: "" }],
  ["github", { key: "github_url", scope: "" }],
  ["personal_website", { key: "website_url", scope: "" }],
  ["work_auth_ca", { key: "work_auth", scope: "CA" }],
  ["work_auth_us", { key: "work_auth", scope: "US" }],
  ["sponsorship_required", { key: "sponsorship_required", scope: "" }],
  ["clearance_held", { key: "security_clearance", scope: "" }],
  ["notice_period", { key: "notice_period", scope: "" }],
  ["years_total", { key: "years_total", scope: "" }],
  ["degree_highest", { key: "degree_highest", scope: "" }],
  ["willing_to_relocate", { key: "willing_relocate", scope: "" }],
  ["driver_s_licence", { key: "drivers_license", scope: "" }],
  ["languages_spoken", { key: "languages", scope: "" }],
  ["gender", { key: "eeo_gender", scope: "" }],
  ["race_ethnicity", { key: "eeo_race_ethnicity", scope: "" }],
  ["hispanic_latino", { key: "eeo_hispanic_latino", scope: "" }],
  ["veteran_status", { key: "eeo_veteran", scope: "" }],
  ["disability", { key: "eeo_disability", scope: "" }],
]);

const QUESTION_TARGETS: readonly (readonly [string, FactTarget])[] = [
  ["Legal first / last name", { key: "legal_name", scope: "" }],
  ["Preferred first name", { key: "preferred_name", scope: "" }],
  ["Email on application forms", { key: "email", scope: "" }],
  ["Email on applications", { key: "email", scope: "" }],
  ["Phone", { key: "phone", scope: "" }],
  ["Current city", { key: "current_city", scope: "" }],
  ["LinkedIn", { key: "linkedin_url", scope: "" }],
  ["GitHub", { key: "github_url", scope: "" }],
  ["Personal website", { key: "website_url", scope: "" }],
  ["Authorized to work in Canada", { key: "work_auth", scope: "CA" }],
  ["Authorized to work in the US", { key: "work_auth", scope: "US" }],
  [
    "Require sponsorship now or in future (US or Canada)",
    { key: "sponsorship_required", scope: "" },
  ],
  ["Security clearance held", { key: "security_clearance", scope: "" }],
  ["Earliest start / notice period", { key: "notice_period", scope: "" }],
  ["Total years of professional experience", { key: "years_total", scope: "" }],
  ["Highest completed degree", { key: "degree_highest", scope: "" }],
  ["Willing to relocate", { key: "willing_relocate", scope: "" }],
  ["Driver's licence", { key: "drivers_license", scope: "" }],
  ["Languages spoken", { key: "languages", scope: "" }],
  ["Gender", { key: "eeo_gender", scope: "" }],
  ["Race / ethnicity (US EEO)", { key: "eeo_race_ethnicity", scope: "" }],
  ["Hispanic or Latino", { key: "eeo_hispanic_latino", scope: "" }],
  ["Protected veteran status", { key: "eeo_veteran", scope: "" }],
  ["Disability", { key: "eeo_disability", scope: "" }],
];

const FACT_TARGET_BY_QUESTION = new Map(
  QUESTION_TARGETS.map(([question, target]) => [normalizeQuestionText(question), target] as const),
);

const CERTIFICATIONS_TARGET: FactTarget = { key: "certifications", scope: "", merge: true };

const CERTIFICATIONS_GROUP = "Certifications";

const FIELD_TYPES_BY_FACT_KEY: ReadonlyMap<string, QuestionFieldType> = new Map([
  ["email", "email"],
  ["phone", "phone"],
  ["linkedin_url", "url"],
  ["github_url", "url"],
  ["website_url", "url"],
  ["years_total", "number"],
]);

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u;

const LEADING_NUMBER = /^\s*(?<number>[0-9]+(?:\.[0-9]+)?)/u;

function targetFor(entry: V1AnswerEntry) {
  const byKey = FACT_TARGETS_BY_KEY.get(entry.key);

  if (byKey !== undefined) {
    return byKey;
  }

  const byQuestion = FACT_TARGET_BY_QUESTION.get(normalizeQuestionText(entry.question));

  if (byQuestion !== undefined) {
    return byQuestion;
  }

  return entry.group === CERTIFICATIONS_GROUP ? CERTIFICATIONS_TARGET : undefined;
}

function cleanValue(key: string, raw: string) {
  const trimmed = raw.trim();

  if (key === "email") {
    return EMAIL_PATTERN.exec(trimmed)?.[0] ?? null;
  }

  if (key === "years_total") {
    return LEADING_NUMBER.exec(trimmed)?.groups?.number ?? null;
  }

  if (key === "linkedin_url" || key === "github_url" || key === "website_url") {
    return trimmed.split(/\s+/u)[0] ?? null;
  }

  return trimmed === "" ? null : trimmed;
}

function factValueIsValid(key: string, value: string) {
  const fieldType = FIELD_TYPES_BY_FACT_KEY.get(key);

  if (fieldType === undefined) {
    return true;
  }

  return answerIsValid(fieldType, [], value);
}

function entrySkip(reason: V1ImportSkipReason) {
  const mapping: EntryMapping = { kind: "skip", reason };

  return mapping;
}

function learnedSkip(reason: V1ImportSkipReason) {
  const mapping: LearnedMapping = { kind: "skip", reason };

  return mapping;
}

export function mapAnswerBankEntry(entry: V1AnswerEntry) {
  const target = targetFor(entry);

  if (target === undefined) {
    return entrySkip("no_catalog_key");
  }

  const parsed = z.string().safeParse(entry.value);

  if (!parsed.success) {
    return entrySkip("invalid_value");
  }

  const value = cleanValue(target.key, parsed.data);

  if (value === null || !factValueIsValid(target.key, value)) {
    return entrySkip("invalid_value");
  }

  const mapping: EntryMapping = {
    kind: "fact",
    key: target.key,
    scope: target.scope,
    value,
    merge: target.merge === true,
  };

  return mapping;
}

function learnedValueIsValid(fieldType: QuestionFieldType, value: string) {
  if (value.trim() === "") {
    return false;
  }

  switch (fieldType) {
    case "email":
    case "phone":
    case "url":
    case "number":
    case "date": {
      return answerIsValid(fieldType, [], value);
    }

    case "file": {
      return false;
    }

    default: {
      return true;
    }
  }
}

export function mapLearnedAnswer(answer: V1LearnedAnswer, catalog: QuestionCatalog) {
  const question = catalog.byLabel(answer.normalizedLabel);

  if (question === undefined) {
    return learnedSkip("unknown_question");
  }

  if (!learnedValueIsValid(question.fieldType, answer.value)) {
    return learnedSkip("invalid_value");
  }

  const mapping: LearnedMapping = {
    kind: "fact",
    key: `q:${question.id}`,
    scope: "",
    value: answer.value.trim(),
    confirmed: answer.source === "owner",
    questionId: question.id,
    needsMapping: question.answerKind === "unknown" && question.mappedBy === null,
  };

  return mapping;
}

interface FactWrite {
  key: string;
  scope: string;
  value: string;
  confirmed: boolean;
  from: string;
}

interface MergedWrite {
  key: string;
  scope: string;
  from: string;
  values: string[];
}

function skillLabel(skill: string, years: number) {
  return `${skill} (${String(years)} ${years === 1 ? "year" : "years"})`;
}

function collectWrites(exported: V1Export, catalog: QuestionCatalog) {
  const writes: FactWrite[] = [];
  const merged = new Map<string, MergedWrite>();
  const skipped: V1SkippedFact[] = [];
  const mappings: { questionId: string; key: string }[] = [];

  for (const entry of exported.answerBank.entries) {
    const mapping = mapAnswerBankEntry(entry);

    if (mapping.kind === "skip") {
      skipped.push({
        key: null,
        scope: "",
        from: `bank:${entry.key}`,
        reason: mapping.reason,
      });
      continue;
    }

    if (mapping.merge) {
      const mergeKey = `${mapping.key}\u0000${mapping.scope}`;
      const current = merged.get(mergeKey);

      if (current === undefined) {
        merged.set(mergeKey, {
          key: mapping.key,
          scope: mapping.scope,
          from: `bank:${entry.key}`,
          values: [mapping.value],
        });
      } else {
        current.values.push(mapping.value);
      }

      continue;
    }

    writes.push({
      key: mapping.key,
      scope: mapping.scope,
      value: mapping.value,
      confirmed: true,
      from: `bank:${entry.key}`,
    });
  }

  if (exported.answerBank.years.length > 0) {
    writes.push({
      key: "skills",
      scope: "",
      value: exported.answerBank.years.map((year) => skillLabel(year.skill, year.years)).join(", "),
      confirmed: true,
      from: `years:${String(exported.answerBank.years.length)}`,
    });
  }

  for (const mergedWrite of merged.values()) {
    writes.push({
      key: mergedWrite.key,
      scope: mergedWrite.scope,
      value: mergedWrite.values.join(", "),
      confirmed: true,
      from: mergedWrite.from,
    });
  }

  for (const achievement of exported.answerBank.achievements) {
    skipped.push({
      key: null,
      scope: "",
      from: `achievement:${String(achievement.position)}`,
      reason: "no_catalog_key",
    });
  }

  for (const answer of exported.learnedAnswers) {
    const mapping = mapLearnedAnswer(answer, catalog);

    if (mapping.kind === "skip") {
      skipped.push({
        key: null,
        scope: "",
        from: `learned:${answer.normalizedLabel}`,
        reason: mapping.reason,
      });
      continue;
    }

    writes.push({
      key: mapping.key,
      scope: mapping.scope,
      value: mapping.value,
      confirmed: mapping.confirmed,
      from: `learned:${answer.normalizedLabel}`,
    });

    if (mapping.needsMapping) {
      mappings.push({ questionId: mapping.questionId, key: mapping.key });
    }
  }

  return { writes, skipped, mappings };
}

export async function importV1Facts(deps: {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
  catalog: QuestionCatalog;
  userId: string;
  exported: V1Export;
}) {
  const { db, clock, personal, catalog, userId, exported } = deps;
  const collected = collectWrites(exported, catalog);

  const imported: V1ImportedFact[] = [];
  const updated: V1ImportedFact[] = [];
  const unchanged: V1ImportedFact[] = [];
  const skipped: V1SkippedFact[] = [...collected.skipped];

  const record = (outcome: "imported" | "updated" | "unchanged", write: FactWrite) => {
    const ref = { key: write.key, scope: write.scope, from: write.from };

    if (outcome === "imported") {
      imported.push(ref);
    } else if (outcome === "updated") {
      updated.push(ref);
    } else {
      unchanged.push(ref);
    }
  };

  async function applyWrite(write: FactWrite) {
    const row = db
      .select()
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.key, write.key), eq(facts.scope, write.scope)))
      .get();

    if (row !== undefined && (row.source === "user" || row.source === "review")) {
      return "kept_user_fact" as const;
    }

    if (row !== undefined) {
      const current = await personal.openFor(
        userId,
        { table: "facts", column: "value_enc", rowId: row.id },
        row.valueEnc,
      );

      if (current === write.value && row.confirmed === write.confirmed) {
        return "unchanged" as const;
      }
    }

    const rowId = row?.id ?? crypto.randomUUID();

    const valueEnc = await personal.sealFor(
      userId,
      { table: "facts", column: "value_enc", rowId },
      write.value,
    );

    const values = {
      userId,
      key: write.key,
      scope: write.scope,
      valueEnc,
      source: "import" as const,
      confirmed: write.confirmed,
      revision: (row?.revision ?? 0) + 1,
      updatedAt: new Date(clock.now()),
    };

    if (row === undefined) {
      db.insert(facts)
        .values({ id: rowId, ...values })
        .run();

      return "imported" as const;
    }

    db.update(facts).set(values).where(eq(facts.id, row.id)).run();

    return "updated" as const;
  }

  const byWrite = new Map<string, FactWrite>();

  for (const write of collected.writes) {
    byWrite.set(`${write.key}\u0000${write.scope}`, write);
  }

  const results = await Promise.all(
    [...byWrite.values()].map(async (write) => ({ write, outcome: await applyWrite(write) })),
  );

  for (const result of results) {
    if (result.outcome === "kept_user_fact") {
      skipped.push({
        key: result.write.key,
        scope: result.write.scope,
        from: result.write.from,
        reason: "kept_user_fact",
      });
    } else {
      record(result.outcome, result.write);
    }
  }

  for (const mapping of collected.mappings) {
    catalog.setMapping(mapping.questionId, {
      answerKind: "fact",
      factKey: mapping.key,
      mappedBy: "owner",
    });
  }

  const report: V1ImportReport = {
    exported: {
      answerBankEntries: exported.answerBank.entries.length,
      answerYears: exported.answerBank.years.length,
      achievements: exported.answerBank.achievements.length,
      aliases: exported.answerBank.aliases.length,
      settings: exported.answerBank.settings.length,
      learnedAnswers: exported.learnedAnswers.length,
    },
    counts: {
      imported: imported.length,
      updated: updated.length,
      unchanged: unchanged.length,
      skipped: skipped.length,
    },
    questionMappings: collected.mappings.length,
    imported,
    updated,
    unchanged,
    skipped,
    notImported: [
      { section: "answer aliases", rows: exported.answerBank.aliases.length },
      { section: "answer settings", rows: exported.answerBank.settings.length },
    ],
  };

  return report;
}
