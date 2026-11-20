import { gunzipSync } from "node:zlib";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { FactRecord } from "../profile/facts.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { AnswerKind, QuestionFieldType } from "../../shared/questions.ts";
import type { QuestionSource } from "../catalog/greenhouse-questions.ts";
import type { GroundedAnswer } from "./open-text.ts";

import {
  applicationAnswers,
  applications,
  companies,
  companyBoards,
  postings,
  resumes,
} from "../platform/db/schema.ts";
import { createFactService } from "../profile/facts.ts";
import { guardPosting } from "./guard/posting-guard.ts";
import { createOpenTextService, isCoverLetterQuestion } from "./open-text.ts";
import { mapQuestionsWithLlm } from "../catalog/question-mapping.ts";
import { createQuestionCatalog, questionInputsFromAts } from "../catalog/questions.ts";
import { resolveLocation } from "../catalog/geo.ts";
import {
  AFFIRMATIVE_OPTION,
  NEGATIVE_OPTION,
  affirmativeOption,
  countriesNamedIn,
  matchOption,
  normalizeQuestionText,
  referencesUserCountry,
} from "../catalog/question-normalize.ts";
import { isCountryScopedFactKey } from "../../shared/facts.ts";
import {
  attachApplication,
  detachApplication,
  dismissEmptyReview,
  ensureOpenReview,
  openReviewsForApplication,
} from "./review-store.ts";

const optionsSchema = z.array(z.string());

const sentencesSchema = z.array(
  z.object({ sentence: z.string().min(1), resumeLineIds: z.array(z.string()) }),
);

const EMPLOYER_SPLIT = /[\n;|]+/u;

function isFreeText(fieldType: QuestionFieldType) {
  return fieldType === "text" || fieldType === "textarea";
}

function descriptionText(descriptionGz: Buffer | null) {
  if (descriptionGz === null) {
    return "";
  }

  try {
    return guardPosting(gunzipSync(descriptionGz).toString("utf8")).safeText;
  } catch {
    return "";
  }
}

function employerNames(facts: ReadonlyMap<string, string>) {
  const names = [facts.get("current_employer") ?? ""];

  for (const entry of (facts.get("employment_history") ?? "").split(EMPLOYER_SPLIT)) {
    const trimmed = entry.trim();

    if (trimmed !== "") {
      names.push(trimmed);
    }
  }

  return names.filter((name) => name !== "");
}

const PREPARABLE_STATUSES = ["preparing", "needs_review", "ready"] as const;

const AFFIRMATIVE_FACT_VALUES = new Set([
  "1",
  "agree",
  "agreed",
  "authorised",
  "authorized",
  "citizen",
  "eligible",
  "i agree",
  "i am authorised",
  "i am authorized",
  "permanent resident",
  "true",
  "y",
  "yes",
]);

const NEGATIVE_FACT_VALUES = new Set([
  "0",
  "disagree",
  "false",
  "i do not require sponsorship",
  "i will not require sponsorship",
  "n",
  "no",
  "not authorised",
  "not authorized",
  "none",
]);

interface ScopedFactEntry {
  scope: string;
  value: string;
}

interface FactIndex {
  unscoped: ReadonlyMap<string, string>;
  scoped: ReadonlyMap<string, ReadonlyMap<string, string>>;
  all: ReadonlyMap<string, readonly ScopedFactEntry[]>;
}

interface ResolveInput {
  questionText: string;
  required: boolean;
  fieldType: QuestionFieldType;
  options: readonly string[];
  answerKind: AnswerKind;
  factKey: string | null;
  facts: FactIndex;
  hasResume: boolean;
}

function indexFacts(records: readonly FactRecord[]) {
  const unscoped = new Map<string, string>();
  const scoped = new Map<string, Map<string, string>>();
  const all = new Map<string, ScopedFactEntry[]>();

  for (const record of records) {
    if (record.scope === "") {
      unscoped.set(record.key, record.value);
    } else {
      const byScope = scoped.get(record.key) ?? new Map<string, string>();

      byScope.set(record.scope, record.value);
      scoped.set(record.key, byScope);
    }

    const entries = all.get(record.key) ?? [];

    entries.push({ scope: record.scope, value: record.value });
    all.set(record.key, entries);
  }

  return { unscoped, scoped, all } satisfies FactIndex;
}

type QuestionScope = { kind: "country"; code: string } | { kind: "multiple" } | { kind: "generic" };

type ScopedLookup =
  | { kind: "answer"; value: string; scope: string }
  | { kind: "review"; scope: string };

function questionScope(questionText: string, facts: FactIndex) {
  const named = countriesNamedIn(questionText);

  if (named.length > 1) {
    return { kind: "multiple" } satisfies QuestionScope;
  }

  const [code] = named;

  if (code !== undefined) {
    return { kind: "country", code } satisfies QuestionScope;
  }

  if (referencesUserCountry(questionText)) {
    const resident = facts.unscoped.get("current_country");
    const countryCode = resident === undefined ? null : resolveLocation(resident).countryCode;

    if (countryCode !== null) {
      return { kind: "country", code: countryCode } satisfies QuestionScope;
    }
  }

  return { kind: "generic" } satisfies QuestionScope;
}

function lookupScopedFact(key: string, questionText: string, facts: FactIndex) {
  const scope = questionScope(questionText, facts);

  if (scope.kind === "country") {
    const value = facts.scoped.get(key)?.get(scope.code);

    return value === undefined
      ? ({ kind: "review", scope: scope.code } satisfies ScopedLookup)
      : ({ kind: "answer", value, scope: scope.code } satisfies ScopedLookup);
  }

  const unscoped = facts.unscoped.get(key);

  if (unscoped !== undefined) {
    return { kind: "answer", value: unscoped, scope: "" } satisfies ScopedLookup;
  }

  if (scope.kind === "multiple") {
    return { kind: "review", scope: "" } satisfies ScopedLookup;
  }

  const values = new Set((facts.all.get(key) ?? []).map((entry) => entry.value));
  const [only] = [...values];

  if (values.size === 1 && only !== undefined) {
    return { kind: "answer", value: only, scope: "" } satisfies ScopedLookup;
  }

  return { kind: "review", scope: "" } satisfies ScopedLookup;
}

function splitName(value: string) {
  const parts = value
    .trim()
    .split(/\s+/u)
    .filter((part) => part !== "");

  return { first: parts.at(0) ?? "", last: parts.at(-1) ?? "" };
}

function formatSelectValue(value: string, options: readonly string[]) {
  if (options.length === 0) {
    const folded = value.trim().toLowerCase();

    if (AFFIRMATIVE_FACT_VALUES.has(folded)) {
      return AFFIRMATIVE_OPTION;
    }

    if (NEGATIVE_FACT_VALUES.has(folded)) {
      return NEGATIVE_OPTION;
    }

    return null;
  }

  return matchOption(value, options);
}

function formatMultiselectValue(value: string, options: readonly string[]) {
  const parts = value
    .split(/[,;|]/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const matched = parts.map((part) => matchOption(part, options));

  return matched.every((option) => option !== null) ? matched.join(", ") : null;
}

function formatFactValue(input: {
  questionText: string;
  fieldType: QuestionFieldType;
  options: readonly string[];
  value: string;
}) {
  const value = input.value.trim();

  if (value === "") {
    return null;
  }

  const normalizedQuestion = normalizeQuestionText(input.questionText);

  if (
    input.fieldType === "select" ||
    input.fieldType === "radio" ||
    input.fieldType === "checkbox"
  ) {
    return formatSelectValue(value, input.options);
  }

  if (input.fieldType === "multiselect") {
    return formatMultiselectValue(value, input.options);
  }

  if (input.fieldType === "email") {
    return value.includes("@") ? value : null;
  }

  if (input.fieldType === "phone") {
    const digits = value.replaceAll(/[^0-9]/gu, "");

    return digits.length >= 7 ? value : null;
  }

  if (input.fieldType === "url") {
    return URL.canParse(value) || /^[a-z][a-z0-9+.-]*:/iu.test(value) ? value : null;
  }

  if (input.fieldType === "number") {
    const number = /[0-9]+(?:\.[0-9]+)?/u.exec(value);

    return number?.[0] ?? null;
  }

  if (input.fieldType === "date") {
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  if (normalizedQuestion === "first name" || normalizedQuestion === "given name") {
    const name = splitName(value).first;

    return name === "" ? null : name;
  }

  if (
    normalizedQuestion === "last name" ||
    normalizedQuestion === "family name" ||
    normalizedQuestion === "surname"
  ) {
    const name = splitName(value).last;

    return name === "" ? null : name;
  }

  return value;
}

const resolveQuestion: (input: ResolveInput) => Resolution = resolveQuestionValue;

const STANDARD_CONSENT =
  /\b(?:privacy|data processing|terms|acknowledg|accuracy|double check|double-check)\b/u;

const MARKETING_CONSENT =
  /\b(?:marketing|newsletter|promotion|job alerts|talent pool|whatsapp|sms|text messages)\b/u;

const RESUME_QUESTION = /\b(?:resume|cv|curriculum vitae)\b/u;

type ResolutionKind = "ready" | "needs_review" | "skip";

interface Resolution {
  kind: ResolutionKind;
  answer: string | null;
  scope: string;
}

function consentAnswer(questionText: string, options: readonly string[]) {
  const normalized = normalizeQuestionText(questionText);

  if (!STANDARD_CONSENT.test(normalized) || MARKETING_CONSENT.test(normalized)) {
    return null;
  }

  const [single] = options;

  if (options.length === 1 && single !== undefined) {
    return single;
  }

  return affirmativeOption(options) ?? (options.length === 0 ? AFFIRMATIVE_OPTION : null);
}

const SKIPPED_FORM: Resolution = { kind: "skip", answer: null, scope: "" };

function reviewFor(scope: string) {
  return { kind: "needs_review", answer: null, scope } satisfies Resolution;
}

function ready(answer: string | null, scope = "") {
  return { kind: "ready", answer, scope } satisfies Resolution;
}

function resolveQuestionValue(input: ResolveInput) {
  const { required } = input;

  if (input.fieldType === "file") {
    if (RESUME_QUESTION.test(normalizeQuestionText(input.questionText))) {
      return input.hasResume || !required ? ready(null) : SKIPPED_FORM;
    }

    return required ? SKIPPED_FORM : ready(null);
  }

  if (input.answerKind === "consent") {
    const answer = consentAnswer(input.questionText, input.options);

    if (answer !== null) {
      return ready(answer);
    }

    return required ? SKIPPED_FORM : ready(null);
  }

  if (input.answerKind === "skip") {
    return required ? SKIPPED_FORM : ready(null);
  }

  if (input.answerKind !== "fact" || input.factKey === null) {
    return required ? reviewFor("") : ready(null);
  }

  if (isCountryScopedFactKey(input.factKey)) {
    const lookup = lookupScopedFact(input.factKey, input.questionText, input.facts);

    if (lookup.kind === "review") {
      return required ? reviewFor(lookup.scope) : ready(null);
    }

    const scopedAnswer = formatFactValue({
      questionText: input.questionText,
      fieldType: input.fieldType,
      options: input.options,
      value: lookup.value,
    });

    if (scopedAnswer !== null) {
      return ready(scopedAnswer, lookup.scope);
    }

    return required ? reviewFor(lookup.scope) : ready(null);
  }

  const value = input.facts.unscoped.get(input.factKey);

  const answer =
    value === undefined
      ? null
      : formatFactValue({
          questionText: input.questionText,
          fieldType: input.fieldType,
          options: input.options,
          value,
        });

  if (answer !== null) {
    return ready(answer);
  }

  return required ? reviewFor("") : ready(null);
}

export function createPreparationService(deps: {
  db: AppDatabase;
  clock: Clock;
  llm: LlmPort;
  personal: PersonalCrypto;
  source: QuestionSource | null;
}) {
  const { db, clock, llm, personal, source } = deps;

  const catalog = createQuestionCatalog({ db, clock });
  const factsService = createFactService({ db, clock, personal });
  const openText = createOpenTextService({ db, clock, llm });

  async function savedSentences(userId: string, applicationId: string, questionId: string) {
    const row = db
      .select()
      .from(applicationAnswers)
      .where(
        and(
          eq(applicationAnswers.applicationId, applicationId),
          eq(applicationAnswers.questionId, questionId),
        ),
      )
      .get();

    if (row === undefined) {
      return null;
    }

    const plaintext = await personal.openFor(
      userId,
      { table: "application_answers", column: "sentences_enc", rowId: row.id },
      row.sentencesEnc,
    );

    const sentences = sentencesSchema.safeParse(JSON.parse(plaintext));

    return sentences.success ? sentences.data : null;
  }

  function clearSentences(applicationId: string, questionId: string) {
    db.delete(applicationAnswers)
      .where(
        and(
          eq(applicationAnswers.applicationId, applicationId),
          eq(applicationAnswers.questionId, questionId),
        ),
      )
      .run();
  }

  async function saveSentences(input: {
    userId: string;
    applicationId: string;
    questionId: string;
    kind: "open_text" | "cover_letter";
    sentences: { sentence: string; resumeLineIds: string[] }[];
    words: number;
  }) {
    const existing = db
      .select({ id: applicationAnswers.id })
      .from(applicationAnswers)
      .where(
        and(
          eq(applicationAnswers.applicationId, input.applicationId),
          eq(applicationAnswers.questionId, input.questionId),
        ),
      )
      .get();

    const id = existing?.id ?? crypto.randomUUID();

    const sealed = await personal.sealFor(
      input.userId,
      { table: "application_answers", column: "sentences_enc", rowId: id },
      JSON.stringify(input.sentences),
    );

    const at = clock.now();

    if (existing === undefined) {
      db.insert(applicationAnswers)
        .values({
          id,
          applicationId: input.applicationId,
          questionId: input.questionId,
          userId: input.userId,
          kind: input.kind,
          sentencesEnc: sealed,
          wordCount: input.words,
          createdAt: at,
          updatedAt: at,
        })
        .run();

      return;
    }

    db.update(applicationAnswers)
      .set({ sentencesEnc: sealed, wordCount: input.words, updatedAt: at })
      .where(eq(applicationAnswers.id, existing.id))
      .run();
  }

  async function loadQuestions(posting: {
    postingId: string;
    ats: "greenhouse" | "lever" | "ashby";
    atsJobId: string;
    boardToken: string;
    companyName: string;
    questionsFetchedAt: number | null;
  }) {
    if (posting.questionsFetchedAt !== null) {
      return;
    }

    if (source === null || posting.ats !== "greenhouse") {
      return;
    }

    const atsQuestions = await source.fetchQuestions(posting.boardToken, posting.atsJobId);
    const inputs = questionInputsFromAts(atsQuestions, [posting.companyName]);

    const entries = inputs.map((input, position) => ({
      question: catalog.findOrCreate({
        text: input.text,
        fieldType: input.fieldType,
        options: input.options,
        companyNames: [posting.companyName],
      }),
      required: input.required,
      options: input.options,
      position,
    }));

    const unresolved = catalog
      .unmapped(entries.map((entry) => entry.question.id))
      .filter((question) => question.fieldType !== "file");

    await mapQuestionsWithLlm(
      { db, clock, llm },
      unresolved.map((question) => {
        const entry = entries.find((candidate) => candidate.question.id === question.id);

        return {
          id: question.id,
          text: question.textDisplay,
          options: entry?.options ?? [],
        };
      }),
      (questionId, mapping) => {
        catalog.setMapping(questionId, { ...mapping, mappedBy: "llm" });
      },
    );

    catalog.savePostingQuestions(
      posting.postingId,
      entries.map((entry) => ({
        questionId: entry.question.id,
        required: entry.required,
        position: entry.position,
        options: entry.options,
      })),
    );

    db.update(postings)
      .set({ questionsFetchedAt: clock.now() })
      .where(eq(postings.id, posting.postingId))
      .run();
  }

  function syncReviews(input: {
    userId: string;
    applicationId: string;
    blocked: readonly {
      questionId: string;
      factKey: string | null;
      prompt: string;
      fieldType: QuestionFieldType;
      options: string[];
      scope: string;
    }[];
  }) {
    const blockedKeys = new Set(
      input.blocked.map((entry) => `${entry.questionId}\u0000${entry.scope}`),
    );

    for (const review of openReviewsForApplication(db, input.userId, input.applicationId)) {
      if (!blockedKeys.has(`${review.questionId}\u0000${review.scope}`)) {
        detachApplication(db, review.id, input.applicationId);
        dismissEmptyReview(db, clock, review.id);
      }
    }

    for (const entry of input.blocked) {
      const reviewId = ensureOpenReview(db, clock, {
        userId: input.userId,
        questionId: entry.questionId,
        factKey: entry.factKey,
        prompt: entry.prompt,
        fieldType: entry.fieldType,
        options: entry.options,
        scope: entry.scope,
      });

      attachApplication(db, reviewId, input.applicationId);
    }
  }

  async function prepare(applicationId: string) {
    const row = db
      .select({
        id: applications.id,
        userId: applications.userId,
        postingId: applications.postingId,
        status: applications.status,
        ats: postings.ats,
        atsJobId: postings.atsJobId,
        boardToken: companyBoards.boardToken,
        companyName: companies.name,
        language: postings.language,
        title: postings.title,
        descriptionGz: postings.descriptionGz,
        questionsFetchedAt: postings.questionsFetchedAt,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companyBoards, eq(companyBoards.id, postings.boardId))
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(eq(applications.id, applicationId))
      .get();

    if (row === undefined || !PREPARABLE_STATUSES.some((status) => status === row.status)) {
      return null;
    }

    const resume = db
      .select({ id: resumes.id, textEnc: resumes.textEnc })
      .from(resumes)
      .where(and(eq(resumes.userId, row.userId), eq(resumes.isCurrent, true)))
      .get();

    const resumeText =
      resume === undefined
        ? ""
        : await personal.openFor(
            row.userId,
            { table: "resumes", column: "text_enc", rowId: resume.id },
            resume.textEnc,
          );

    await loadQuestions(row);

    const factRows = await factsService.list(row.userId);
    const factValues = indexFacts(factRows);
    const questionRows = catalog.forPosting(row.postingId);

    const blocked: {
      questionId: string;
      factKey: string | null;
      prompt: string;
      fieldType: QuestionFieldType;
      options: string[];
      scope: string;
    }[] = [];

    const openTextQuestions: {
      questionId: string;
      text: string;
      kind: "open_text" | "cover_letter";
      required: boolean;
    }[] = [];

    let unsupportedReason: "form_unsupported" | "open_text_ungrounded" | null = null;

    for (const question of questionRows) {
      const options = optionsSchema.parse(JSON.parse(question.options));

      if (question.answerKind === "open_text" && isFreeText(question.fieldType)) {
        const kind = isCoverLetterQuestion(question.textDisplay) ? "cover_letter" : "open_text";

        openTextQuestions.push({
          questionId: question.questionId,
          text: question.textDisplay,
          kind,
          required: question.required,
        });

        continue;
      }

      const resolution = resolveQuestion({
        questionText: question.textDisplay,
        required: question.required,
        fieldType: question.fieldType,
        options,
        answerKind: question.answerKind,
        factKey: question.factKey,
        facts: factValues,
        hasResume: resume !== undefined,
      });

      if (resolution.kind === "skip") {
        unsupportedReason ??= "form_unsupported";
      }

      if (resolution.kind === "needs_review") {
        blocked.push({
          questionId: question.questionId,
          factKey: question.factKey,
          prompt: question.textDisplay,
          fieldType: question.fieldType,
          options,
          scope: resolution.scope,
        });
      }
    }

    let generated = new Map<string, GroundedAnswer>();

    if (openTextQuestions.length > 0 && resumeText.trim() !== "") {
      generated = await openText.generate({
        userId: row.userId,
        resumeText,
        context: { employers: employerNames(factValues.unscoped) },
        posting: {
          title: guardPosting(row.title).safeText,
          company: guardPosting(row.companyName).safeText,
          language: row.language,
          description: descriptionText(row.descriptionGz),
        },
        facts: factValues.unscoped,
        questions: openTextQuestions.map((question) => ({
          questionId: question.questionId,
          text: question.text,
          kind: question.kind,
        })),
      });

      await Promise.all(
        openTextQuestions.map(async (question) => {
          const answer = generated.get(question.questionId);

          if (answer === undefined) {
            return;
          }

          await saveSentences({
            userId: row.userId,
            applicationId,
            questionId: question.questionId,
            kind: question.kind,
            sentences: answer.sentences,
            words: answer.words,
          });
        }),
      );
    }

    for (const question of openTextQuestions) {
      if (!generated.has(question.questionId)) {
        clearSentences(applicationId, question.questionId);

        if (question.required) {
          unsupportedReason ??= "open_text_ungrounded";
        }
      }
    }

    syncReviews({
      userId: row.userId,
      applicationId,
      blocked: unsupportedReason === null ? blocked : [],
    });

    if (unsupportedReason !== null) {
      db.update(applications)
        .set({
          status: "skipped",
          statusReason: unsupportedReason,
          stage: null,
          updatedAt: clock.now(),
        })
        .where(eq(applications.id, applicationId))
        .run();

      return { status: "skipped" as const, blocked: 0 };
    }

    const status = blocked.length === 0 ? "ready" : "needs_review";

    if (status !== row.status) {
      db.update(applications)
        .set({
          status,
          statusReason: status === "needs_review" ? "unknown_question" : null,
          updatedAt: clock.now(),
        })
        .where(eq(applications.id, applicationId))
        .run();
    }

    return { status, blocked: blocked.length };
  }

  async function prepareMany(applicationIds: readonly string[]) {
    await Promise.all(applicationIds.map(async (applicationId) => prepare(applicationId)));
  }

  async function answersFor(applicationId: string) {
    const row = db
      .select({ userId: applications.userId, postingId: applications.postingId })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (row === undefined) {
      return [];
    }

    const factRows = await factsService.list(row.userId);
    const factValues = indexFacts(factRows);

    const resume = db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, row.userId), eq(resumes.isCurrent, true)))
      .get();

    return Promise.all(
      catalog.forPosting(row.postingId).map(async (question) => {
        const options = optionsSchema.parse(JSON.parse(question.options));

        if (question.answerKind === "open_text" && isFreeText(question.fieldType)) {
          const saved = await savedSentences(row.userId, applicationId, question.questionId);

          return {
            questionId: question.questionId,
            text: question.textDisplay,
            fieldType: question.fieldType,
            answerKind: question.answerKind,
            factKey: question.factKey,
            required: question.required,
            resolved: saved !== null,
            answer: saved === null ? null : saved.map((sentence) => sentence.sentence).join(" "),
            sentences: saved ?? [],
          };
        }

        const resolution = resolveQuestion({
          questionText: question.textDisplay,
          required: question.required,
          fieldType: question.fieldType,
          options,
          answerKind: question.answerKind,
          factKey: question.factKey,
          facts: factValues,
          hasResume: resume !== undefined,
        });

        return {
          questionId: question.questionId,
          text: question.textDisplay,
          fieldType: question.fieldType,
          answerKind: question.answerKind,
          factKey: question.factKey,
          required: question.required,
          resolved: resolution.kind === "ready",
          answer: resolution.answer,
          sentences: [],
          scope: resolution.scope,
        };
      }),
    );
  }

  return { answersFor, prepare, prepareMany };
}

export type PreparationService = ReturnType<typeof createPreparationService>;
