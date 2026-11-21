import { and, eq, inArray, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { AnswerKind, QuestionFieldType, QuestionMapper } from "../../shared/questions.ts";
import type { AtsQuestion } from "./greenhouse-questions.ts";
import type { RuleMapping } from "./question-rules.ts";

import { postingQuestions, questionVariants, questions } from "../platform/db/schema.ts";
import {
  normalizeFieldType,
  normalizeQuestionText,
  questionOptionsHash,
  questionVariantHash,
} from "./question-normalize.ts";
import { mapQuestionByRules } from "./question-rules.ts";

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
}

export function createQuestionCatalog(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  function byVariantHash(hash: string) {
    return db
      .select({
        factKey: questions.factKey,
        id: questions.id,
        answerKind: questions.answerKind,
        mappedBy: questions.mappedBy,
        fieldType: questions.fieldType,
        seenCount: questions.seenCount,
        textDisplay: questions.textDisplay,
      })
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
    const id = crypto.randomUUID();
    const optionsHash = questionOptionsHash(input.options);

    db.insert(questions)
      .values({
        id,
        textDisplay: input.text,
        textNormHash: variantHash,
        fieldType: input.fieldType,
        optionsHash,
        factKey: mapping.factKey,
        answerKind: mapping.answerKind,
        mappedBy: mapping.answerKind === "unknown" ? null : "rules",
        seenCount: 1,
        createdAt: clock.now(),
      })
      .run();

    db.insert(questionVariants).values({ variantHash, questionId: id }).onConflictDoNothing().run();

    return {
      id,
      textDisplay: input.text,
      fieldType: input.fieldType,
      factKey: mapping.factKey,
      answerKind: mapping.answerKind,
      mappedBy: mapping.answerKind === "unknown" ? null : ("rules" as const),
      seenCount: 1,
    } satisfies QuestionRecord;
  }

  function findOrCreate(input: QuestionInput) {
    const variantHash = questionVariantHash(input.text, input.companyNames);
    const existing = byVariantHash(variantHash);

    if (existing !== undefined) {
      noteSeen(existing.id, existing.seenCount);

      return { ...existing, seenCount: existing.seenCount + 1 } satisfies QuestionRecord;
    }

    const mapped = mapQuestionByRules(input.text);

    const fallback: RuleMapping = { answerKind: "unknown", factKey: null };

    return create(input, mapped ?? fallback);
  }

  function byLabel(text: string) {
    return byVariantHash(questionVariantHash(text));
  }

  function byId(id: string) {
    return db
      .select({
        id: questions.id,
        textDisplay: questions.textDisplay,
        fieldType: questions.fieldType,
        factKey: questions.factKey,
        answerKind: questions.answerKind,
        mappedBy: questions.mappedBy,
        seenCount: questions.seenCount,
      })
      .from(questions)
      .where(eq(questions.id, id))
      .get();
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
    db.delete(postingQuestions).where(eq(postingQuestions.postingId, postingId)).run();

    for (const entry of entries) {
      db.insert(postingQuestions)
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
  }

  function forPosting(postingId: string) {
    return db
      .select({
        questionId: postingQuestions.questionId,
        required: postingQuestions.required,
        position: postingQuestions.position,
        options: postingQuestions.options,
        fieldName: postingQuestions.fieldName,
        textDisplay: questions.textDisplay,
        fieldType: questions.fieldType,
        factKey: questions.factKey,
        answerKind: questions.answerKind,
        mappedBy: questions.mappedBy,
        seenCount: questions.seenCount,
      })
      .from(postingQuestions)
      .innerJoin(questions, eq(questions.id, postingQuestions.questionId))
      .where(eq(postingQuestions.postingId, postingId))
      .orderBy(postingQuestions.position)
      .all();
  }

  return {
    byId,
    byLabel,
    findOrCreate,
    forPosting,
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
