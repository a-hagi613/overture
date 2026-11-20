import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { AnswerKind, QuestionFieldType } from "../../shared/questions.ts";
import type { QuestionSource } from "../catalog/greenhouse-questions.ts";

import {
  applications,
  companies,
  companyBoards,
  postings,
  resumes,
} from "../platform/db/schema.ts";
import { createFactService } from "../profile/facts.ts";
import { mapQuestionsWithLlm } from "../catalog/question-mapping.ts";
import { createQuestionCatalog, questionInputsFromAts } from "../catalog/questions.ts";
import {
  AFFIRMATIVE_OPTION,
  NEGATIVE_OPTION,
  matchOption,
  normalizeQuestionText,
} from "../catalog/question-normalize.ts";
import {
  attachApplication,
  detachApplication,
  dismissEmptyReview,
  ensureOpenReview,
  openReviewsForApplication,
} from "./review-store.ts";

const optionsSchema = z.array(z.string());

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

interface ResolveInput {
  questionText: string;
  fieldType: QuestionFieldType;
  options: readonly string[];
  answerKind: AnswerKind;
  factKey: string | null;
  facts: ReadonlyMap<string, string>;
  hasResume: boolean;
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

function isResolved(input: ResolveInput) {
  if (input.answerKind === "skip" || input.answerKind === "consent") {
    return true;
  }

  if (input.fieldType === "file") {
    return input.hasResume;
  }

  if (input.answerKind !== "fact" || input.factKey === null) {
    return false;
  }

  const value = input.facts.get(input.factKey);

  if (value === undefined) {
    return false;
  }

  return (
    formatFactValue({
      questionText: input.questionText,
      fieldType: input.fieldType,
      options: input.options,
      value,
    }) !== null
  );
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

  async function loadQuestions(posting: {
    id: string;
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

    const unresolved = catalog.unmapped(entries.map((entry) => entry.question.id));

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
      posting.id,
      entries.map((entry) => ({
        questionId: entry.question.id,
        required: entry.required,
        position: entry.position,
        options: entry.options,
      })),
    );

    db.update(postings)
      .set({ questionsFetchedAt: clock.now() })
      .where(eq(postings.id, posting.id))
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
    }[];
  }) {
    const blockedIds = new Set(input.blocked.map((entry) => entry.questionId));

    for (const review of openReviewsForApplication(db, input.userId, input.applicationId)) {
      if (!blockedIds.has(review.questionId)) {
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
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, row.userId), eq(resumes.isCurrent, true)))
      .get();

    if (resume === undefined) {
      return { status: row.status, blocked: 0 };
    }

    await loadQuestions(row);

    const factRows = await factsService.list(row.userId);
    const factValues = new Map(factRows.map((fact) => [fact.key, fact.value]));
    const questionRows = catalog.forPosting(row.postingId);

    const blocked: {
      questionId: string;
      factKey: string | null;
      prompt: string;
      fieldType: QuestionFieldType;
      options: string[];
    }[] = [];

    for (const question of questionRows) {
      const options = optionsSchema.parse(JSON.parse(question.options));

      const resolved = isResolved({
        questionText: question.textDisplay,
        fieldType: question.fieldType,
        options,
        answerKind: question.answerKind,
        factKey: question.factKey,
        facts: factValues,
        hasResume: true,
      });

      if (!resolved && question.required) {
        blocked.push({
          questionId: question.questionId,
          factKey: question.factKey,
          prompt: question.textDisplay,
          fieldType: question.fieldType,
          options,
        });
      }
    }

    syncReviews({
      userId: row.userId,
      applicationId,
      blocked,
    });

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
    const factValues = new Map(factRows.map((fact) => [fact.key, fact.value]));

    const resume = db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, row.userId), eq(resumes.isCurrent, true)))
      .get();

    return catalog.forPosting(row.postingId).map((question) => {
      const options = optionsSchema.parse(JSON.parse(question.options));

      const value =
        question.answerKind === "fact" && question.factKey !== null
          ? (factValues.get(question.factKey) ?? null)
          : null;

      return {
        questionId: question.questionId,
        text: question.textDisplay,
        fieldType: question.fieldType,
        answerKind: question.answerKind,
        factKey: question.factKey,
        required: question.required,
        resolved: isResolved({
          questionText: question.textDisplay,
          fieldType: question.fieldType,
          options,
          answerKind: question.answerKind,
          factKey: question.factKey,
          facts: factValues,
          hasResume: resume !== undefined,
        }),
        answer:
          value === null
            ? null
            : formatFactValue({
                questionText: question.textDisplay,
                fieldType: question.fieldType,
                options,
                value,
              }),
      };
    });
  }

  return { answersFor, prepare, prepareMany };
}

export type PreparationService = ReturnType<typeof createPreparationService>;
