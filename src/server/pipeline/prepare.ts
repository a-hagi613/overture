import { gunzipSync } from "node:zlib";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import { isApplySupportedAts } from "../../shared/ats.ts";
import type { AnswerKind, QuestionFieldType, ReviewReason } from "../../shared/questions.ts";
import type { AnswerSource, BlockReason, PlanResolution } from "./answer-plan.ts";
import type { AnswerUnit, FileFact } from "./answer-value.ts";
import type { QuestionSource } from "../catalog/greenhouse-questions.ts";
import type { GroundedAnswer } from "./open-text.ts";
import type { PostingPlace } from "../catalog/answer-derivations.ts";
import type { FormReadPath, PlainFormReader } from "./form-read.ts";
import type { LoginWallEvidence, LoginWallFormRead } from "./login-wall.ts";

import {
  applicationAnswers,
  applications,
  profiles,
  questions as questionsTable,
  resumes,
} from "../platform/db/schema.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";

import type { FormQuestion, SendPlan, SendPlanField } from "./send-plan.ts";
import { createFactService } from "../profile/facts.ts";
import { createPlainFormReader, isLoginWallRead } from "./form-read.ts";
import { LOGIN_WALL_REASON } from "./login-wall.ts";
import { createPlanCache } from "./plan-cache.ts";
import { guardPosting } from "./guard/posting-guard.ts";
import { createOpenTextService, isCoverLetterQuestion } from "./open-text.ts";
import { isKillSwitchEnabled } from "../platform/settings/index.ts";
import { createTargetsService } from "../profile/targets.ts";
import type { SpendGate } from "../billing/spend.ts";
import { ungatedSpend } from "../billing/spend.ts";
import { greenhouseBoardUrl } from "./greenhouse-board-url.ts";
import { countriesNamedIn } from "../catalog/question-normalize.ts";
import { mapQuestionsWithLlm } from "../catalog/question-mapping.ts";
import { createQuestionCatalog, questionInputsFromAts } from "../catalog/questions.ts";
import { logInfo } from "../platform/log.ts";
import { isCountryScopedFactKey } from "../../shared/facts.ts";
import { indexFacts, isUnsupportedBlock, resolveQuestion } from "./answer-plan.ts";
import { answerIsValid, formatFactValue } from "./answer-value.ts";
import { prepareUsersOfFacts, returnStaleApprovals } from "./approval-invalidation.ts";
import { wordCount } from "./grounding.ts";
import { INITIAL_CONSENT_VERSION } from "../../shared/consent.ts";
import {
  attachApplication,
  detachApplication,
  dismissEmptyReview,
  ensureOpenReview,
  openReviewsForApplication,
} from "./review-store.ts";
import { recordAutoAnswer } from "./review-events.ts";
import { PREPARABLE_STATUSES, updatePreparableApplication } from "./preparable-status.ts";
import { stageForStatus } from "./stage.ts";

const optionsSchema = z.array(z.string());

const sentencesSchema = z.array(
  z.object({
    byUser: z.boolean().optional(),
    resumeLineIds: z.array(z.string()),
    sentence: z.string().min(1),
  }),
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

interface StoredSentence {
  sentence: string;
  resumeLineIds: string[];
  byUser?: boolean | undefined;
}

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
  catalogDb: CatalogDatabase;
  clock: Clock;
  llm: LlmPort;
  personal: PersonalCrypto;
  source: QuestionSource | null;
  greenhouseBoardOrigin?: string | undefined;
  onReady?: (applicationId: string, userId: string) => void;
  /** When gated, nothing is prepared without Applications left (trial or plan). */
  spendGate?: SpendGate | undefined;
  plainFormReader?: PlainFormReader;
  captureForm?: (input: {
    ats: "lever" | "ashby" | "workable" | "personio";
    region: "us" | "eu";
    boardToken: string;
    atsJobId: string;
    applyUrl: string | null;
    url: string;
  }) => Promise<{ questions: FormQuestion[]; formSignature: string } | LoginWallFormRead | null>;
}) {
  const {
    db,
    catalogDb,
    clock,
    llm,
    personal,
    source,
    greenhouseBoardOrigin,
    onReady,
    captureForm,
    spendGate = ungatedSpend,
  } = deps;

  const catalog = createQuestionCatalog({ db, catalogDb, clock });
  const factsService = createFactService({ db, clock, personal });
  const openText = createOpenTextService({ db, clock, llm });
  const planCache = createPlanCache({ db, clock });
  const plainFormReader = deps.plainFormReader ?? createPlainFormReader();

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
    sentences: StoredSentence[];
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

  function markQuestionsFetched(postingId: string) {
    catalogDb
      .update(postings)
      .set({ questionsFetchedAt: clock.now() })
      .where(eq(postings.id, postingId))
      .run();
  }

  async function loadQuestions(posting: {
    postingId: string;
    ats: "greenhouse" | "lever" | "ashby" | "workable" | "personio";
    atsJobId: string;
    boardToken: string;
    boardRegion: "us" | "eu";
    companyName: string;
    applyUrl: string | null;
    url: string;
    questionsFetchedAt: number | null;
  }) {
    if (posting.questionsFetchedAt !== null) {
      return null;
    }

    const recordQuestions = async (
      inputs: readonly {
        text: string;
        fieldType: QuestionFieldType;
        options: string[];
        required: boolean;
        fieldName: string | null;
      }[],
    ) => {
      const entries = inputs.map((input, position) => {
        const question = catalog.findOrCreate({
          text: input.text,
          fieldType: input.fieldType,
          options: input.options,
          companyNames: [posting.companyName],
        });

        return {
          fieldName: input.fieldName,
          options: input.options,
          position,
          questionId: question.id,
          required: input.required,
        };
      });

      const unresolved = catalog
        .unmapped(entries.map((entry) => entry.questionId))
        .filter((question) => question.fieldType !== "file");

      await mapQuestionsWithLlm(
        { db, clock, llm },
        unresolved.map((question) => {
          const entry = entries.find((candidate) => candidate.questionId === question.id);

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

      catalog.savePostingQuestions(posting.postingId, entries);

      return entries;
    };

    if (posting.ats === "greenhouse") {
      if (source === null) {
        return null;
      }

      const atsQuestions = await source.fetchQuestions(posting.boardToken, posting.atsJobId);
      const inputs = questionInputsFromAts(atsQuestions, [posting.companyName]);

      await recordQuestions(inputs);

      markQuestionsFetched(posting.postingId);

      return null;
    }

    const target = {
      applyUrl: posting.applyUrl,
      ats: posting.ats,
      atsJobId: posting.atsJobId,
      boardToken: posting.boardToken,
      region: posting.boardRegion,
      url: posting.url,
    };

    let questions: FormQuestion[] = [];
    let formSignature = "";
    let readPath: FormReadPath = "browser";
    let loginWall: LoginWallEvidence | null = null;
    const plain = await plainFormReader.read(target);

    if (isLoginWallRead(plain)) {
      loginWall = plain.evidence;
    } else if (plain !== null && plain.questions.length > 0) {
      ({ questions, formSignature, path: readPath } = plain);
    } else {
      const captured = captureForm === undefined ? null : await captureForm(target);

      if (captured !== null && "loginWall" in captured) {
        loginWall = captured.evidence;
      } else if (captured !== null && captured.questions.length > 0) {
        ({ formSignature, questions } = captured);
        readPath = "browser";
      }
    }

    if (loginWall !== null) {
      return loginWall;
    }

    if (questions.length === 0 || formSignature === "") {
      throw new Error(
        `form_unreadable: ${posting.ats} ${posting.atsJobId} returned no questions; the Application stays in preparation`,
      );
    }

    const cached = planCache.get(posting.ats, formSignature);

    const matched = cached === null ? null : planCache.match(questions, cached.plan.questions);

    let usedCache = false;

    if (cached !== null && matched !== null) {
      const alive =
        matched.length === 0
          ? []
          : db
              .select({ id: questionsTable.id })
              .from(questionsTable)
              .where(
                inArray(
                  questionsTable.id,
                  matched.map((entry) => entry.questionId),
                ),
              )
              .all();

      if (alive.length === matched.length) {
        catalog.savePostingQuestions(
          posting.postingId,
          matched.map((entry) => ({
            fieldName: entry.fieldName === "" ? null : entry.fieldName,
            options: entry.options,
            position: entry.position,
            questionId: entry.questionId,
            required: entry.required,
          })),
        );
        planCache.recordHit(cached.id);
        usedCache = true;
      } else {
        planCache.recordFailure(cached.id);
      }
    } else if (cached !== null) {
      planCache.recordFailure(cached.id);
    }

    if (!usedCache) {
      const entries = await recordQuestions(
        questions.map((question) => ({
          fieldName: question.fieldName === "" ? null : question.fieldName,
          fieldType: question.fieldType,
          options: question.options,
          required: question.required,
          text: question.label,
        })),
      );

      planCache.put(posting.ats, formSignature, {
        questions: entries.map((entry, position) => ({
          fieldName: entry.fieldName ?? "",
          fieldType: questions[position]?.fieldType ?? "text",
          label: questions[position]?.label ?? "",
          options: entry.options,
          position,
          questionId: entry.questionId,
          required: entry.required,
        })),
        readPath,
      });
    }

    markQuestionsFetched(posting.postingId);

    return null;
  }

  function syncReviews(input: {
    userId: string;
    applicationId: string;
    attemptId?: string;
    ats: "greenhouse" | "lever" | "ashby" | "workable" | "personio";
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
        attemptId: input.attemptId ?? null,
        ats: input.ats,
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
    const application = db
      .select({ postingId: applications.postingId })
      .from(applications)
      .where(eq(applications.id, input.applicationId))
      .get();

    if (application === undefined) {
      return [];
    }

    const row = catalogDb
      .select({
        ats: postings.ats,
        companyName: companies.name,
        postingId: postings.id,
      })
      .from(postings)
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(eq(postings.id, application.postingId))
      .get();

    if (row === undefined || !isApplySupportedAts(row.ats)) {
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
        ats: row.ats,
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
    const application = db
      .select({
        id: applications.id,
        userId: applications.userId,
        postingId: applications.postingId,
        status: applications.status,
      })
      .from(applications)
      .where(
        and(
          eq(applications.id, applicationId),
          inArray(applications.status, [...PREPARABLE_STATUSES]),
        ),
      )
      .get();

    if (application === undefined) {
      return null;
    }

    const postingRow = catalogDb
      .select({
        ats: postings.ats,
        atsJobId: postings.atsJobId,
        boardToken: companyBoards.boardToken,
        boardRegion: companyBoards.region,
        companyName: companies.name,
        countryCode: postings.countryCode,
        city: postings.city,
        region: postings.region,
        locationRaw: postings.locationRaw,
        language: postings.language,
        title: postings.title,
        descriptionGz: postings.descriptionGz,
        applyUrl: postings.applyUrl,
        url: postings.url,
        questionsFetchedAt: postings.questionsFetchedAt,
      })
      .from(postings)
      .innerJoin(companyBoards, eq(companyBoards.id, postings.boardId))
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(eq(postings.id, application.postingId))
      .get();

    if (postingRow === undefined) {
      return null;
    }

    const { ats } = postingRow;

    if (!isApplySupportedAts(ats)) {
      return null;
    }

    const row = { ...application, ...postingRow, ats };

    if (!spendGate.allows(row.userId)) {
      logInfo("spend", `preparation skipped for ${applicationId}: no Applications left`);

      return { status: "skipped" as const, blocked: 0 };
    }

    if (
      (row.ats === "workable" || row.ats === "personio") &&
      isKillSwitchEnabled(db, "ats", row.ats)
    ) {
      const updated = updatePreparableApplication(db, applicationId, {
        status: "skipped",
        statusReason: "ats_not_enabled",
        stage: null,
        updatedAt: clock.now(),
      });

      return updated ? { status: "skipped" as const, blocked: 0 } : null;
    }

    const loginWall = await loadQuestions(row);

    if (loginWall !== null) {
      logInfo(
        "prepare",
        `application ${applicationId} skipped: ${LOGIN_WALL_REASON} (${loginWall.markers.join(", ")})`,
      );

      const skipped = updatePreparableApplication(db, applicationId, {
        status: "skipped",
        statusReason: LOGIN_WALL_REASON,
        stage: null,
        updatedAt: clock.now(),
      });

      return skipped ? { status: "skipped" as const, blocked: 0 } : null;
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

    const userEditedOpenText = new Map<string, StoredSentence[]>();

    await Promise.all(
      openTextQuestions.map(async (question) => {
        const saved = await savedSentences(row.userId, applicationId, question.questionId);

        if (saved?.some((sentence) => sentence.byUser === true) === true) {
          userEditedOpenText.set(question.questionId, saved);
        }
      }),
    );

    const generatedQuestions = openTextQuestions.filter(
      (question) => !userEditedOpenText.has(question.questionId),
    );

    let generated = new Map<string, GroundedAnswer>();

    if (generatedQuestions.length > 0 && resumeText.trim() !== "") {
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
        questions: generatedQuestions.map((question) => ({
          questionId: question.questionId,
          text: question.text,
          kind: question.kind,
        })),
      });

      await Promise.all(
        generatedQuestions.map(async (question) => {
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
      const userEdited = userEditedOpenText.get(question.questionId) ?? null;

      if (answer === null && userEdited === null) {
        clearSentences(applicationId, question.questionId);

        if (question.required) {
          unsupportedReason ??= "open_text_ungrounded";
        }
      }

      resolutions.set(
        question.questionId,
        openTextResolution(userEdited ?? answer?.sentences ?? null, question.required),
      );
    }

    const complete = questionRows.every((question) => {
      const resolution = resolutions.get(question.questionId);

      return !question.required || resolution?.kind === "answer";
    });

    if (!complete && unsupportedReason === null && blocked.length === 0) {
      unsupportedReason = "form_unsupported";
    }

    if (unsupportedReason !== null) {
      const skipped = updatePreparableApplication(db, applicationId, {
        status: "skipped",
        statusReason: unsupportedReason,
        stage: null,
        updatedAt: clock.now(),
      });

      if (!skipped) {
        return null;
      }

      syncReviews({
        applicationId,
        ats: row.ats,
        userId: row.userId,
        blocked: [],
      });

      return { status: "skipped" as const, blocked: 0 };
    }

    syncReviews({
      applicationId,
      ats: row.ats,
      userId: row.userId,
      blocked,
    });

    for (const question of questionRows) {
      const resolution = resolutions.get(question.questionId);

      if (resolution?.kind !== "answer") {
        continue;
      }

      recordAutoAnswer(db, clock, {
        applicationId,
        ats: row.ats,
        factKey: question.factKey,
        factRevision: resolution.factRevision,
        questionId: question.questionId,
        scope: resolution.scope,
        source: resolution.source,
        userId: row.userId,
      });
    }

    const status = blocked.length === 0 ? "ready" : "needs_review";
    let changed = true;

    if (status !== row.status) {
      const now = clock.now();

      changed = updatePreparableApplication(db, applicationId, {
        status,
        statusReason: status === "needs_review" ? "unknown_question" : null,
        stage: stageForStatus(status),
        readyAt: status === "ready" ? now : null,
        updatedAt: now,
      });
    }

    if (!changed) {
      return null;
    }

    if (status === "ready" && row.status !== "ready") {
      onReady?.(applicationId, row.userId);
    }

    return { status, blocked: blocked.length };
  }

  async function prepareMany(applicationIds: readonly string[]) {
    await Promise.all(applicationIds.map(async (applicationId) => prepare(applicationId)));
  }

  async function editAnswer(input: {
    applicationId: string;
    questionId: string;
    userId: string;
    value: string;
  }) {
    const row = db
      .select({ status: applications.status, userId: applications.userId })
      .from(applications)
      .where(eq(applications.id, input.applicationId))
      .get();

    if (row === undefined || row.userId !== input.userId) {
      return { kind: "not_found" };
    }

    if (row.status !== "ready") {
      return { kind: "not_editable" };
    }

    const plan = await sendPlanFor(input.applicationId);

    if (plan === null) {
      return { kind: "not_editable" };
    }

    const field = plan.fields.find((candidate) => candidate.questionId === input.questionId);

    if (field === undefined) {
      return { kind: "question_not_found" };
    }

    const value = input.value.trim();

    if (field.answerKind === "fact" && field.factKey !== null) {
      const formatted = formatFactValue({
        questionText: field.label,
        factKey: field.factKey,
        fieldType: field.fieldType,
        options: field.options,
        value,
      });

      if (formatted === null || !answerIsValid(field.fieldType, field.options, formatted.value)) {
        return { kind: "invalid_answer" };
      }

      const saved = await factsService.save(input.userId, field.factKey, value, field.scope);

      const invalidated = await returnStaleApprovals({
        clock,
        db,
        personal,
        userId: input.userId,
      });

      if (saved.revision !== field.factRevision) {
        await prepareUsersOfFacts({
          answersFor,
          clock,
          db,
          facts: [{ key: field.factKey, scope: field.scope }],
          skip: invalidated.map((stale) => stale.applicationId),
          userId: input.userId,
        });
      }

      return {
        answer: formatted.value,
        byUser: false,
        factKey: field.factKey,
        factRevision: saved.revision,
        invalidated: invalidated.map((stale) => stale.applicationId),
        kind: "saved",
      };
    }

    if (field.answerKind === "open_text" && isFreeText(field.fieldType)) {
      if (!answerIsValid(field.fieldType, field.options, value)) {
        return { kind: "invalid_answer" };
      }

      await saveSentences({
        applicationId: input.applicationId,
        kind: isCoverLetterQuestion(field.label) ? "cover_letter" : "open_text",
        questionId: field.questionId,
        sentences: [{ byUser: true, resumeLineIds: [], sentence: value }],
        userId: input.userId,
        words: wordCount(value),
      });

      return {
        answer: value,
        byUser: true,
        factKey: null,
        factRevision: null,
        invalidated: [],
        kind: "saved",
      };
    }

    return { kind: "not_editable" };
  }

  async function sendPlanFor(applicationId: string) {
    const application = db
      .select({
        id: applications.id,
        userId: applications.userId,
        postingId: applications.postingId,
      })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (application === undefined) {
      return null;
    }

    const postingRow = catalogDb
      .select({
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
      .from(postings)
      .innerJoin(companyBoards, eq(companyBoards.id, postings.boardId))
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(eq(postings.id, application.postingId))
      .get();

    if (postingRow === undefined) {
      return null;
    }

    const { ats } = postingRow;

    if (!isApplySupportedAts(ats)) {
      return null;
    }

    const row = { ...application, ...postingRow, ats };

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
      consentVersion: profile?.consentVersion ?? INITIAL_CONSENT_VERSION,
      coverLetter:
        coverLetterField === undefined
          ? null
          : coverLetterField.sentences.map((sentence) => ({
              byUser: sentence.byUser === true,
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
    const application = db
      .select({
        userId: applications.userId,
        postingId: applications.postingId,
      })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (application === undefined) {
      return [];
    }

    const postingRow = catalogDb
      .select({
        companyName: companies.name,
        countryCode: postings.countryCode,
        city: postings.city,
        region: postings.region,
        locationRaw: postings.locationRaw,
      })
      .from(postings)
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(eq(postings.id, application.postingId))
      .get();

    if (postingRow === undefined) {
      return [];
    }

    const row = { ...application, ...postingRow };

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

  return {
    answersFor,
    editAnswer,
    openAttemptReviews,
    prepare,
    prepareMany,
    sendPlanFor,
  };
}

export type PreparationService = ReturnType<typeof createPreparationService>;
