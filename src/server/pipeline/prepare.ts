import { gunzipSync } from "node:zlib";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { AnswerKind, QuestionFieldType, ReviewReason } from "../../shared/questions.ts";
import type { AnswerSource, BlockReason, PlanResolution } from "./answer-plan.ts";
import type { AnswerUnit, FileFact } from "./answer-value.ts";
import type { QuestionSource } from "../catalog/greenhouse-questions.ts";
import type { GroundedAnswer } from "./open-text.ts";
import type { PostingPlace } from "../catalog/answer-derivations.ts";

import {
  applicationAnswers,
  applications,
  companies,
  companyBoards,
  postings,
  profiles,
  resumes,
} from "../platform/db/schema.ts";
import type { SendPlan, SendPlanField } from "./send-plan.ts";
import { createFactService } from "../profile/facts.ts";
import { guardPosting } from "./guard/posting-guard.ts";
import { createOpenTextService, isCoverLetterQuestion } from "./open-text.ts";
import { createTargetsService } from "../profile/targets.ts";
import { greenhouseBoardUrl } from "./greenhouse-board-url.ts";
import { countriesNamedIn } from "../catalog/question-normalize.ts";
import { mapQuestionsWithLlm } from "../catalog/question-mapping.ts";
import { createQuestionCatalog, questionInputsFromAts } from "../catalog/questions.ts";
import { isCountryScopedFactKey } from "../../shared/facts.ts";
import { indexFacts, isUnsupportedBlock, resolveQuestion } from "./answer-plan.ts";
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

interface BlockedQuestion {
  questionId: string;
  factKey: string | null;
  prompt: string;
  fieldType: QuestionFieldType;
  options: string[];
  scope: string;
  reason: ReviewReason;
}

interface PreparedAnswer {
  questionId: string;
  text: string;
  fieldName: string | null;
  fieldType: QuestionFieldType;
  answerKind: AnswerKind;
  factKey: string | null;
  required: boolean;
  options: string[];
  resolved: boolean;
  source: AnswerSource | null;
  answer: string | null;
  file: FileFact | null;
  unit: AnswerUnit | null;
  factRevision: number | null;
  scope: string;
  block: BlockReason | null;
  reason: ReviewReason | null;
  sentences: { sentence: string; resumeLineIds: string[] }[];
}

function reviewReasonFor(reason: BlockReason) {
  return reason === "option_mismatch" ? "option_missing" : "unknown_required";
}

function toPreparedAnswer(input: {
  question: {
    questionId: string;
    textDisplay: string;
    fieldName: string | null;
    fieldType: QuestionFieldType;
    answerKind: AnswerKind;
    factKey: string | null;
    required: boolean;
  };
  options: string[];
  resolution: PlanResolution;
  sentences: { sentence: string; resumeLineIds: string[] }[];
}) {
  const common = {
    questionId: input.question.questionId,
    text: input.question.textDisplay,
    fieldName: input.question.fieldName,
    fieldType: input.question.fieldType,
    answerKind: input.question.answerKind,
    factKey: input.question.factKey,
    required: input.question.required,
    options: input.options,
    sentences: input.sentences,
  };

  if (input.resolution.kind === "answer") {
    return {
      ...common,
      resolved: true,
      source: input.resolution.source,
      answer: input.resolution.value,
      file: input.resolution.file,
      unit: input.resolution.unit,
      factRevision: input.resolution.factRevision,
      scope: input.resolution.scope,
      block: null,
      reason: null,
    } satisfies PreparedAnswer;
  }

  if (input.resolution.kind === "blocked") {
    return {
      ...common,
      resolved: false,
      source: null,
      answer: null,
      file: input.resolution.file,
      unit: null,
      factRevision: null,
      scope: input.resolution.scope,
      block: input.resolution.reason,
      reason: reviewReasonFor(input.resolution.reason),
    } satisfies PreparedAnswer;
  }

  return {
    ...common,
    resolved: false,
    source: null,
    answer: null,
    file: input.resolution.file,
    unit: null,
    factRevision: null,
    scope: "",
    block: input.resolution.reason,
    reason: null,
  } satisfies PreparedAnswer;
}

function openTextResolution(
  saved: { sentence: string; resumeLineIds: string[] }[] | null,
  required: boolean,
) {
  if (saved !== null) {
    return {
      kind: "answer",
      value: saved.map((sentence) => sentence.sentence).join(" "),
      source: "open_text",
      file: null,
      unit: null,
      scope: "",
      factRevision: null,
    } satisfies PlanResolution;
  }

  if (required) {
    return {
      kind: "blocked",
      reason: "open_text_ungrounded",
      scope: "",
      file: null,
    } satisfies PlanResolution;
  }

  return { kind: "blank", reason: "optional_unfilled", file: null } satisfies PlanResolution;
}

export function createPreparationService(deps: {
  db: AppDatabase;
  clock: Clock;
  llm: LlmPort;
  personal: PersonalCrypto;
  source: QuestionSource | null;
  greenhouseBoardOrigin?: string | undefined;
  onReady?: (applicationId: string, userId: string) => void;
}) {
  const { db, clock, llm, personal, source, greenhouseBoardOrigin, onReady } = deps;

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

  const targetsService = createTargetsService({ db, clock });

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
      fieldName: input.fieldName,
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
        fieldName: entry.fieldName,
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
      reason: ReviewReason;
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
        reason: entry.reason,
      });

      attachApplication(db, reviewId, input.applicationId);
    }
  }

  function openAttemptReviews(input: {
    applicationId: string;
    userId: string;
    attemptId: string;
    fields: readonly {
      label: string;
      fieldType: QuestionFieldType | null;
      options: string[];
      fieldName: string | null;
    }[];
  }) {
    const row = db
      .select({
        companyName: companies.name,
        postingId: postings.id,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(eq(applications.id, input.applicationId))
      .get();

    if (row === undefined) {
      return [];
    }

    const reviewIds: string[] = [];

    for (const field of input.fields) {
      if (field.fieldType === null || field.label.trim() === "") {
        continue;
      }

      const question = catalog.findOrCreate({
        companyNames: [row.companyName],
        fieldType: field.fieldType,
        options: field.options,
        text: field.label,
      });

      catalog.addPostingQuestion(row.postingId, {
        fieldName: field.fieldName,
        options: field.options,
        questionId: question.id,
        required: true,
      });

      const [scope] = countriesNamedIn(field.label);

      const factKey = question.answerKind === "fact" ? question.factKey : null;

      const reviewId = ensureOpenReview(db, clock, {
        attemptId: input.attemptId,
        factKey,
        fieldType: field.fieldType,
        options: field.options,
        prompt: field.label,
        questionId: question.id,
        reason: "unknown_required",
        scope: factKey !== null && isCountryScopedFactKey(factKey) ? (scope ?? "") : "",
        userId: input.userId,
      });

      attachApplication(db, reviewId, input.applicationId);
      reviewIds.push(reviewId);
    }

    return reviewIds;
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
        countryCode: postings.countryCode,
        city: postings.city,
        region: postings.region,
        locationRaw: postings.locationRaw,
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
    const settings = await targetsService.read(row.userId);
    const questionRows = catalog.forPosting(row.postingId);

    const posting: PostingPlace = {
      companyName: row.companyName,
      countryCode: row.countryCode,
      city: row.city,
      region: row.region,
      locationRaw: row.locationRaw,
    };

    const blocked: BlockedQuestion[] = [];
    const resolutions = new Map<string, PlanResolution>();

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
        targets: settings.targets,
        posting,
        hasResume: resume !== undefined,
        hasCoverLetter: false,
      });

      resolutions.set(question.questionId, resolution);

      if (resolution.kind === "blocked") {
        if (isUnsupportedBlock(resolution.reason)) {
          unsupportedReason ??= "form_unsupported";
        } else {
          blocked.push({
            questionId: question.questionId,
            factKey: question.answerKind === "fact" ? question.factKey : null,
            prompt: question.textDisplay,
            fieldType: question.fieldType,
            options,
            scope: resolution.scope,
            reason: reviewReasonFor(resolution.reason),
          });
        }
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
      const answer = generated.get(question.questionId) ?? null;

      if (answer === null) {
        clearSentences(applicationId, question.questionId);

        if (question.required) {
          unsupportedReason ??= "open_text_ungrounded";
        }
      }

      resolutions.set(
        question.questionId,
        openTextResolution(answer?.sentences ?? null, question.required),
      );
    }

    const complete = questionRows.every((question) => {
      const resolution = resolutions.get(question.questionId);

      return !question.required || resolution?.kind === "answer";
    });

    if (!complete && unsupportedReason === null && blocked.length === 0) {
      unsupportedReason = "form_unsupported";
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

    if (status === "ready" && row.status !== "ready") {
      onReady?.(applicationId, row.userId);
    }

    return { status, blocked: blocked.length };
  }

  async function prepareMany(applicationIds: readonly string[]) {
    await Promise.all(applicationIds.map(async (applicationId) => prepare(applicationId)));
  }

  async function sendPlanFor(applicationId: string) {
    const row = db
      .select({
        id: applications.id,
        userId: applications.userId,
        postingId: applications.postingId,
        ats: postings.ats,
        url: postings.url,
        applyUrl: postings.applyUrl,
        title: postings.title,
        descriptionHash: postings.descriptionHash,
        companyName: companies.name,
        boardToken: companyBoards.boardToken,
        boardRegion: companyBoards.region,
        atsJobId: postings.atsJobId,
        countryCode: postings.countryCode,
        city: postings.city,
        region: postings.region,
        locationRaw: postings.locationRaw,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companyBoards, eq(companyBoards.id, postings.boardId))
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(eq(applications.id, applicationId))
      .get();

    if (row === undefined) {
      return null;
    }

    const factRows = await factsService.list(row.userId);
    const factIndex = indexFacts(factRows);
    const settings = await targetsService.read(row.userId);

    const posting: PostingPlace = {
      companyName: row.companyName,
      countryCode: row.countryCode,
      city: row.city,
      region: row.region,
      locationRaw: row.locationRaw,
    };

    const resume = db
      .select()
      .from(resumes)
      .where(and(eq(resumes.userId, row.userId), eq(resumes.isCurrent, true)))
      .get();

    const profile = db.select().from(profiles).where(eq(profiles.userId, row.userId)).get();

    const fields = await Promise.all(
      catalog.forPosting(row.postingId).map(async (question) => {
        const options = optionsSchema.parse(JSON.parse(question.options));

        if (question.answerKind === "open_text" && isFreeText(question.fieldType)) {
          const saved = await savedSentences(row.userId, applicationId, question.questionId);

          return {
            answer: saved === null ? null : saved.map((sentence) => sentence.sentence).join(" "),
            answerKind: question.answerKind,
            block: saved === null ? "optional_unfilled" : null,
            factKey: question.factKey,
            factRevision: null,
            fieldName: question.fieldName,
            fieldType: question.fieldType,
            file: null,
            label: question.textDisplay,
            options,
            questionId: question.questionId,
            required: question.required,
            scope: "",
            sentences: saved ?? [],
            source: saved === null ? null : "open_text",
            unit: null,
          } satisfies SendPlanField;
        }

        const resolution = resolveQuestion({
          questionText: question.textDisplay,
          required: question.required,
          fieldType: question.fieldType,
          options,
          answerKind: question.answerKind,
          factKey: question.factKey,
          facts: factIndex,
          targets: settings.targets,
          posting,
          hasResume: resume !== undefined,
          hasCoverLetter: false,
        });

        const resolved = resolution.kind === "answer" ? resolution : null;

        return {
          answer:
            resolved === null || resolved.source === "file" || question.fieldType === "file"
              ? null
              : resolved.value,
          answerKind: question.answerKind,
          block: resolution.kind === "answer" ? null : resolution.reason,
          factKey: question.factKey,
          factRevision: resolved?.factRevision ?? null,
          fieldName: question.fieldName,
          fieldType: question.fieldType,
          file: resolved?.file ?? null,
          label: question.textDisplay,
          options,
          questionId: question.questionId,
          required: question.required,
          scope: resolved?.scope ?? "",
          sentences: [],
          source: resolved?.source ?? null,
          unit: resolved?.unit ?? null,
        } satisfies SendPlanField;
      }),
    );

    const coverLetterField = fields.find(
      (field) =>
        field.answerKind === "open_text" &&
        isFreeText(field.fieldType) &&
        isCoverLetterQuestion(field.label) &&
        field.sentences.length > 0,
    );

    return {
      applicationId,
      ats: row.ats,
      atsJobId: row.atsJobId,
      boardToken: row.boardToken,
      companyName: row.companyName,
      consentVersion: profile?.consentVersion ?? "m1",
      coverLetter:
        coverLetterField === undefined
          ? null
          : coverLetterField.sentences.map((sentence) => ({
              resumeLineIds: sentence.resumeLineIds,
              sentence: sentence.sentence,
            })),
      descriptionHash: row.descriptionHash ?? null,
      fields,
      postingTitle: row.title,
      postingUrl:
        row.ats === "greenhouse"
          ? greenhouseBoardUrl({
              atsJobId: row.atsJobId,
              boardToken: row.boardToken,
              origin: greenhouseBoardOrigin,
              region: row.boardRegion,
            })
          : (row.applyUrl ?? row.url),
      resume:
        resume === undefined
          ? null
          : {
              filename: await personal.openFor(
                row.userId,
                { column: "filename_enc", rowId: resume.id, table: "resumes" },
                resume.filenameEnc,
              ),
              id: resume.id,
              sha256: resume.sha256,
            },
      userId: row.userId,
    } satisfies SendPlan;
  }

  async function answersFor(applicationId: string) {
    const row = db
      .select({
        userId: applications.userId,
        postingId: applications.postingId,
        companyName: companies.name,
        countryCode: postings.countryCode,
        city: postings.city,
        region: postings.region,
        locationRaw: postings.locationRaw,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(eq(applications.id, applicationId))
      .get();

    if (row === undefined) {
      return [];
    }

    const factRows = await factsService.list(row.userId);
    const factValues = indexFacts(factRows);
    const settings = await targetsService.read(row.userId);

    const posting: PostingPlace = {
      companyName: row.companyName,
      countryCode: row.countryCode,
      city: row.city,
      region: row.region,
      locationRaw: row.locationRaw,
    };

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

          return toPreparedAnswer({
            question,
            options,
            resolution: openTextResolution(saved, question.required),
            sentences: saved ?? [],
          });
        }

        const resolution = resolveQuestion({
          questionText: question.textDisplay,
          required: question.required,
          fieldType: question.fieldType,
          options,
          answerKind: question.answerKind,
          factKey: question.factKey,
          facts: factValues,
          targets: settings.targets,
          posting,
          hasResume: resume !== undefined,
          hasCoverLetter: false,
        });

        return toPreparedAnswer({ question, options, resolution, sentences: [] });
      }),
    );
  }

  return { answersFor, openAttemptReviews, prepare, prepareMany, sendPlanFor };
}

export type PreparationService = ReturnType<typeof createPreparationService>;
