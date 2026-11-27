import { and, eq, inArray, isNull } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { AnswerKind, QuestionFieldType, QuestionMapper } from "../../shared/questions.ts";
import type { AtsQuestion } from "./greenhouse-questions.ts";

import { jobQuestions, questionVariants, questions } from "../platform/db/schema.ts";
import { postingQuestions } from "../platform/db/catalog-schema.ts";
import { bestEffortCatalogWrite } from "../platform/db/read-only-catalog.ts";
import {
  normalizeFieldType,
  normalizeQuestionText,
  questionOptionsHash,
  questionVariantHash,
} from "./question-normalize.ts";
import { mapIdentityFieldName, mapQuestionByRules } from "./question-rules.ts";

export interface QuestionRecord {
  id: string;
  textDisplay: string;
  fieldType: QuestionFieldType;
  factKey: string | null;
  answerKind: AnswerKind;
  mappedBy: QuestionMapper | null;
  seenCount: number;
}

export interface QuestionInput {
  text: string;
  fieldType: QuestionFieldType;
  options: string[];
  companyNames: string[];
  fieldName?: string | null;
}

const QUESTION_COLUMNS = {
  answerKind: questions.answerKind,
  factKey: questions.factKey,
  fieldType: questions.fieldType,
  id: questions.id,
  mappedBy: questions.mappedBy,
  seenCount: questions.seenCount,
  textDisplay: questions.textDisplay,
};

export function createQuestionCatalog(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
}) {
  const { db, catalogDb, clock } = deps;

  function byVariantHash(hash: string) {
    return db
      .select(QUESTION_COLUMNS)
      .from(questionVariants)
      .innerJoin(questions, eq(questions.id, questionVariants.questionId))
      .where(eq(questionVariants.variantHash, hash))
      .get();
  }

  function noteSeen(questionId: string, seenCount: number) {
    db.update(questions)
      .set({ seenCount: seenCount + 1 })
      .where(eq(questions.id, questionId))
      .run();
  }

  function create(
    input: QuestionInput,
    mapping: { answerKind: AnswerKind; factKey: string | null },
  ) {
    const variantHash = questionVariantHash(input.text, input.companyNames);
    const optionsHash = questionOptionsHash(input.options);

    const record = {
      answerKind: mapping.answerKind,
      factKey: mapping.factKey,
      fieldType: input.fieldType,
      id: crypto.randomUUID(),
      mappedBy: mapping.answerKind === "unknown" ? null : "rules",
      seenCount: 1,
      textDisplay: input.text,
    } satisfies QuestionRecord;

    db.insert(questions)
      .values({ ...record, createdAt: clock.now(), optionsHash, textNormHash: variantHash })
      .run();

    db.insert(questionVariants)
      .values({ variantHash, questionId: record.id })
      .onConflictDoNothing()
      .run();

    return record;
  }

  function findOrCreate(input: QuestionInput) {
    const variantHash = questionVariantHash(input.text, input.companyNames);
    const existing = byVariantHash(variantHash);

    if (existing !== undefined) {
      noteSeen(existing.id, existing.seenCount);

      return { ...existing, seenCount: existing.seenCount + 1 } satisfies QuestionRecord;
    }

    const mapped = mapQuestionByRules(input.text) ?? mapIdentityFieldName(input.fieldName ?? null);

    return create(input, mapped ?? { answerKind: "unknown", factKey: null });
  }

  function byLabel(text: string) {
    return byVariantHash(questionVariantHash(text));
  }

  function byId(id: string) {
    return db.select(QUESTION_COLUMNS).from(questions).where(eq(questions.id, id)).get();
  }

  function setMapping(
    questionId: string,
    mapping: { answerKind: AnswerKind; factKey: string | null; mappedBy: QuestionMapper },
  ) {
    db.update(questions)
      .set({ answerKind: mapping.answerKind, factKey: mapping.factKey, mappedBy: mapping.mappedBy })
      .where(eq(questions.id, questionId))
      .run();
  }

  function unmapped(questionIds: readonly string[]) {
    if (questionIds.length === 0) {
      return [];
    }

    return db
      .select({
        id: questions.id,
        textDisplay: questions.textDisplay,
        fieldType: questions.fieldType,
      })
      .from(questions)
      .where(
        and(
          inArray(questions.id, [...questionIds]),
          eq(questions.answerKind, "unknown"),
          isNull(questions.mappedBy),
        ),
      )
      .all();
  }

  function addPostingQuestion(
    postingId: string,
    entry: {
      questionId: string;
      required: boolean;
      options: string[];
      fieldName: string | null;
    },
  ) {
    const positions = catalogDb
      .select({ position: postingQuestions.position })
      .from(postingQuestions)
      .where(eq(postingQuestions.postingId, postingId))
      .all();

    let highest = -1;

    for (const row of positions) {
      highest = Math.max(highest, row.position);
    }

    const position = highest + 1;

    catalogDb
      .insert(postingQuestions)
      .values({
        postingId,
        questionId: entry.questionId,
        required: entry.required,
        position,
        options: JSON.stringify(entry.options),
        fieldName: entry.fieldName,
      })
      .onConflictDoNothing()
      .run();
  }

  function savePostingQuestions(
    postingId: string,
    entries: readonly {
      questionId: string;
      required: boolean;
      position: number;
      options: string[];
      fieldName: string | null;
    }[],
  ) {
    bestEffortCatalogWrite("catalog.questions", () => {
      catalogDb.delete(postingQuestions).where(eq(postingQuestions.postingId, postingId)).run();

      for (const entry of entries) {
        catalogDb
          .insert(postingQuestions)
          .values({
            postingId,
            questionId: entry.questionId,
            required: entry.required,
            position: entry.position,
            options: JSON.stringify(entry.options),
            fieldName: entry.fieldName,
          })
          .onConflictDoNothing()
          .run();
      }
    });
  }

  function joinedQuestions(
    linked: readonly {
      questionId: string;
      required: boolean;
      position: number;
      options: string;
      fieldName: string | null;
    }[],
  ) {
    if (linked.length === 0) {
      return [];
    }

    const questionRows = db
      .select(QUESTION_COLUMNS)
      .from(questions)
      .where(
        inArray(
          questions.id,
          linked.map((row) => row.questionId),
        ),
      )
      .all();

    const questionsById = new Map(questionRows.map((row) => [row.id, row]));

    return linked.flatMap((row) => {
      const question = questionsById.get(row.questionId);

      return question === undefined ? [] : [{ ...row, ...question }];
    });
  }

  function forPosting(postingId: string) {
    return joinedQuestions(
      catalogDb
        .select({
          questionId: postingQuestions.questionId,
          required: postingQuestions.required,
          position: postingQuestions.position,
          options: postingQuestions.options,
          fieldName: postingQuestions.fieldName,
        })
        .from(postingQuestions)
        .where(eq(postingQuestions.postingId, postingId))
        .orderBy(postingQuestions.position)
        .all(),
    );
  }

  /**
   * The freehire job's question list, stored in this database (issue #710). It mirrors `forPosting` for a job id that
   * never existed in the catalog, so preparation and Review work after launch without a catalog mirror.
   * @param jobId The freehire posting id.
   * @returns The linked questions in form order, newest store wins.
   */
  function forJob(jobId: string) {
    return joinedQuestions(
      db
        .select({
          questionId: jobQuestions.questionId,
          required: jobQuestions.required,
          position: jobQuestions.position,
          options: jobQuestions.options,
          fieldName: jobQuestions.fieldName,
        })
        .from(jobQuestions)
        .where(eq(jobQuestions.jobId, jobId))
        .orderBy(jobQuestions.position)
        .all(),
    );
  }

  /**
   * Replaces one freehire job's question list in this database. The list is the form as it was fetched, so a later
   * preparation reuses it instead of asking the employer's site again.
   * @param jobId The freehire posting id.
   * @param entries The questions in form order.
   */
  function saveJobQuestions(
    jobId: string,
    entries: readonly {
      questionId: string;
      required: boolean;
      position: number;
      options: string[];
      fieldName: string | null;
    }[],
  ) {
    db.transaction((tx) => {
      tx.delete(jobQuestions).where(eq(jobQuestions.jobId, jobId)).run();

      for (const entry of entries) {
        tx.insert(jobQuestions)
          .values({
            jobId,
            questionId: entry.questionId,
            required: entry.required,
            position: entry.position,
            options: JSON.stringify(entry.options),
            fieldName: entry.fieldName,
          })
          .onConflictDoNothing()
          .run();
      }
    });
  }

  /**
   * Appends one question to a freehire job's stored list, used when an attempt finds a field preparation had not seen.
   * @param jobId The freehire posting id.
   * @param entry The question to add.
   */
  function addJobQuestion(
    jobId: string,
    entry: { questionId: string; required: boolean; options: string[]; fieldName: string | null },
  ) {
    const highest = db
      .select({ position: jobQuestions.position })
      .from(jobQuestions)
      .where(eq(jobQuestions.jobId, jobId))
      .all()
      .reduce((max, row) => Math.max(max, row.position), -1);

    db.insert(jobQuestions)
      .values({
        jobId,
        questionId: entry.questionId,
        required: entry.required,
        position: highest + 1,
        options: JSON.stringify(entry.options),
        fieldName: entry.fieldName,
      })
      .onConflictDoNothing()
      .run();
  }

  return {
    addJobQuestion,
    addPostingQuestion,
    byId,
    byLabel,
    findOrCreate,
    forJob,
    forPosting,
    saveJobQuestions,
    savePostingQuestions,
    setMapping,
    unmapped,
  };
}

export function questionInputsFromAts(
  atsQuestions: readonly AtsQuestion[],
  companyNames: readonly string[],
) {
  return atsQuestions.flatMap((question) => {
    const field = question.fields.at(0);

    if (field === undefined) {
      return [];
    }

    const fieldType = normalizeFieldType(field.type, field.name);
    const options = field.values.map((value) => value.label).filter((label) => label !== "");

    return [
      {
        text: question.label,
        fieldType,
        options,
        required: question.required,
        fieldName: field.name === "" ? null : field.name,
        textNormalized: normalizeQuestionText(question.label, [...companyNames]),
      },
    ];
  });
}

export type QuestionCatalog = ReturnType<typeof createQuestionCatalog>;
