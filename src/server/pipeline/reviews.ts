import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { QuestionFieldType, ReviewCategory, ReviewReason } from "../../shared/questions.ts";
import type { PreparationService } from "./prepare.ts";

import { applications, reviewApplications, reviews } from "../platform/db/schema.ts";
import { jobPostingsById } from "../jobs/job-posting.ts";
import { createQuestionCatalog } from "../catalog/questions.ts";
import { countryNameFor } from "../catalog/geo.ts";
import { reviewCategory } from "../catalog/question-normalize.ts";
import { createFactService } from "../profile/facts.ts";
import { factLabelFor } from "../../shared/facts.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { recordApplicationEvent } from "../applications/events.ts";
import { applicationIdsForReview, detachApplication, dismissEmptyReview } from "./review-store.ts";
import { recordReviewResolved } from "./review-events.ts";
import { enqueueApplicationPrepare } from "./prepare-jobs.ts";
import { returnStaleApprovals } from "./approval-invalidation.ts";

const optionsSchema = z.array(z.string());

export interface ReviewApplicationView {
  applicationId: string;
  company: string;
  title: string;
  postingId: string;
}

export interface ReviewView {
  id: string;
  prompt: string;
  fieldType: QuestionFieldType;
  options: string[];
  factKey: string | null;
  scope: string;
  factLabel: string | null;
  reason: ReviewReason;
  category: ReviewCategory;
  unlocked: number;
  companies: number;
  applications: ReviewApplicationView[];
  saveForFutureDefault: boolean;
  createdAt: number;
}

function isFreeTextQuestion(fieldType: QuestionFieldType) {
  return fieldType === "text" || fieldType === "textarea";
}

function saveForFutureDefaultFor(fieldType: QuestionFieldType, category: ReviewCategory) {
  return !isFreeTextQuestion(fieldType) || category !== "other";
}

function openReviewRows(db: AppDatabase, userId: string) {
  return db
    .select({
      id: reviews.id,
      questionId: reviews.questionId,
      factKey: reviews.factKey,
      scope: reviews.scope,
      prompt: reviews.prompt,
      fieldType: reviews.fieldType,
      options: reviews.options,
      reason: reviews.reason,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.status, "open")))
    .all();
}

function openApplicationIds(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  applicationIds: readonly string[],
) {
  if (applicationIds.length === 0) {
    return new Set<string>();
  }

  const rows = db
    .select({ id: applications.id, postingId: applications.postingId })
    .from(applications)
    .where(inArray(applications.id, [...applicationIds]))
    .all();

  if (rows.length === 0) {
    return new Set<string>();
  }

  const open = new Set(
    [
      ...jobPostingsById(
        { catalogDb, db },
        rows.map((row) => row.postingId),
      ).values(),
    ].flatMap((posting) => (posting.open ? [posting.postingId] : [])),
  );

  return new Set(rows.flatMap((row) => (open.has(row.postingId) ? [row.id] : [])));
}

interface ReviewAttachment {
  applicationId: string;
  company: string;
  reviewId: string;
  title: string;
  postingId: string;
}

function attachmentsForReviews(db: AppDatabase, reviewIds: readonly string[]) {
  if (reviewIds.length === 0) {
    return [];
  }

  return db
    .select({
      applicationId: applications.id,
      company: applications.companyName,
      title: applications.postingTitle,
      postingId: applications.postingId,
      reviewId: reviewApplications.reviewId,
    })
    .from(reviewApplications)
    .innerJoin(applications, eq(applications.id, reviewApplications.applicationId))
    .where(inArray(reviewApplications.reviewId, [...reviewIds]))
    .orderBy(applications.createdAt, applications.id)
    .all();
}

function attachmentsByReview(attachments: readonly ReviewAttachment[]) {
  const grouped = new Map<string, ReviewAttachment[]>();

  for (const attachment of attachments) {
    const list = grouped.get(attachment.reviewId) ?? [];

    list.push(attachment);
    grouped.set(attachment.reviewId, list);
  }

  return grouped;
}

function openReviewsWithAttachments(db: AppDatabase, userId: string) {
  const openReviews = openReviewRows(db, userId);

  const attachments = attachmentsForReviews(
    db,
    openReviews.map((review) => review.id),
  );

  return { attachments, reviews: openReviews };
}

function sweepClosedAttachments(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  clock: Clock,
  userId: string,
) {
  const loaded = openReviewsWithAttachments(db, userId);

  const open = openApplicationIds(
    db,
    catalogDb,
    loaded.attachments.map((attachment) => attachment.applicationId),
  );

  const kept = loaded.attachments.filter((attachment) => open.has(attachment.applicationId));
  const detached = loaded.attachments.filter((attachment) => !open.has(attachment.applicationId));

  for (const attachment of detached) {
    detachApplication(db, attachment.reviewId, attachment.applicationId);
  }

  const remaining = attachmentsByReview(kept);

  let dismissed = false;

  for (const review of loaded.reviews) {
    if ((remaining.get(review.id) ?? []).length === 0) {
      dismissEmptyReview(db, clock, review.id);
      dismissed = true;
    }
  }

  if (detached.length === 0 && !dismissed) {
    return loaded;
  }

  return openReviewsWithAttachments(db, userId);
}

/**
 * Every open Review with the Applications waiting on it, read in a fixed number
 * of queries rather than one per Review.
 * @param input The application database, catalog database, clock and the signed-in person.
 * @returns The reviews, most Applications first.
 */
export function listReviews(input: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  userId: string;
}) {
  const { db, catalogDb, clock, userId } = input;

  const { attachments, reviews: openReviews } = sweepClosedAttachments(
    db,
    catalogDb,
    clock,
    userId,
  );

  const byReview = attachmentsByReview(attachments);

  const views: ReviewView[] = openReviews.map((review) => {
    const reviewAttachments = byReview.get(review.id) ?? [];
    const companiesUnlocked = new Set(reviewAttachments.map((attachment) => attachment.company));
    const label = review.factKey === null ? null : factLabelFor(review.factKey);
    const country = review.scope === "" ? null : countryNameFor(review.scope);
    const category = reviewCategory(review.prompt, review.factKey);

    let factLabel = label;

    if (label !== null && country !== null) {
      factLabel = `${label} (${country})`;
    }

    return {
      id: review.id,
      prompt: review.prompt,
      fieldType: review.fieldType,
      options: optionsSchema.parse(JSON.parse(review.options)),
      factKey: review.factKey,
      scope: review.scope,
      factLabel,
      reason: review.reason,
      category,
      unlocked: reviewAttachments.length,
      companies: companiesUnlocked.size,
      applications: reviewAttachments,
      saveForFutureDefault: saveForFutureDefaultFor(review.fieldType, category),
      createdAt: review.createdAt,
    };
  });

  return views.toSorted(
    (left, right) => right.unlocked - left.unlocked || left.createdAt - right.createdAt,
  );
}

export function createReviewService(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  personal: PersonalCrypto;
  preparation: PreparationService;
}) {
  const { db, catalogDb, clock, personal, preparation } = deps;

  const catalog = createQuestionCatalog({ db, catalogDb, clock });
  const factsService = createFactService({ db, clock, personal });

  interface ResolvedAnswer {
    reviewId: string;
    factKey: string | null;
    scope: string;
    applicationIds: string[];
    saveForFuture: boolean;
  }

  async function resolveAnswer(
    userId: string,
    reviewId: string,
    value: string,
    options: {
      fact?: { key: string; scope: string };
      saveForFuture?: boolean;
    } = {},
  ) {
    const review = db
      .select()
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.userId, userId), eq(reviews.status, "open")))
      .get();

    if (review === undefined) {
      return null;
    }

    const target = options.fact ?? null;
    const factKey = target?.key ?? review.factKey ?? `q:${review.questionId}`;
    const scope = target?.scope ?? review.scope;
    const saveForFuture = options.saveForFuture ?? true;
    const applicationIds = applicationIdsForReview(db, reviewId);

    if (saveForFuture) {
      if (target === null) {
        await factsService.saveFromReview(userId, factKey, value, review.scope);
      } else {
        await factsService.save(userId, factKey, value, scope);
      }

      catalog.setMapping(review.questionId, { answerKind: "fact", factKey, mappedBy: "owner" });
    } else {
      await Promise.all(
        applicationIds.map(async (applicationId) =>
          preparation.saveApplicationAnswer({
            applicationId,
            kind: "fact",
            questionId: review.questionId,
            userId,
            value,
          }),
        ),
      );
    }

    db.update(reviews)
      .set({ status: "answered", resolvedAt: clock.now() })
      .where(eq(reviews.id, reviewId))
      .run();

    recordReviewResolved(db, clock, {
      questionId: review.questionId,
      resolution: "answered",
      reviewId,
      userId,
    });

    publishEvent(db, clock, "review.resolved", JSON.stringify({ reviewId }), userId);
    publishEvent(db, clock, "home.updated", JSON.stringify({ reviewId }), userId);

    return {
      reviewId,
      factKey: saveForFuture ? factKey : null,
      scope: saveForFuture ? scope : "",
      applicationIds,
      saveForFuture,
    };
  }

  async function settleAnswers(
    userId: string,
    resolved: readonly ResolvedAnswer[],
    prepare: "await" | "enqueue",
  ) {
    await returnStaleApprovals({ clock, db, personal, userId });

    const applicationIds = [...new Set(resolved.flatMap((entry) => entry.applicationIds))];

    if (prepare === "enqueue") {
      for (const applicationId of applicationIds) {
        enqueueApplicationPrepare(db, clock, applicationId);
      }
    } else {
      await preparation.prepareMany(applicationIds);
    }

    let readyCount = 0;

    if (applicationIds.length > 0) {
      const statuses = db
        .select({ status: applications.status })
        .from(applications)
        .where(inArray(applications.id, applicationIds))
        .all();

      for (const row of statuses) {
        if (row.status === "ready") {
          readyCount += 1;
        }
      }
    }

    return { applicationIds, readyCount };
  }

  async function answer(
    userId: string,
    reviewId: string,
    value: string,
    options: {
      fact?: { key: string; scope: string };
      prepare?: "await" | "enqueue";
      saveForFuture?: boolean;
    } = {},
  ) {
    const resolved = await resolveAnswer(userId, reviewId, value, options);

    if (resolved === null) {
      return null;
    }

    const { applicationIds, readyCount } = await settleAnswers(
      userId,
      [resolved],
      options.prepare ?? "await",
    );

    return {
      reviewId,
      factKey: resolved.factKey,
      scope: resolved.scope,
      applicationIds,
      readyCount,
      saveForFuture: resolved.saveForFuture,
    };
  }

  async function answerMany(
    userId: string,
    answers: readonly { reviewId: string; value: string; saveForFuture?: boolean | undefined }[],
  ) {
    const ids = answers.map((entry) => entry.reviewId);

    const open = db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.status, "open"), inArray(reviews.id, ids)))
      .all();

    if (open.length !== new Set(ids).size) {
      return null;
    }

    const settled = await Promise.all(
      answers.map(async (entry) =>
        resolveAnswer(userId, entry.reviewId, entry.value, {
          saveForFuture: entry.saveForFuture ?? true,
        }),
      ),
    );

    if (settled.some((one) => one === null)) {
      return null;
    }

    const resolved = settled.filter((one): one is ResolvedAnswer => one !== null);
    const { applicationIds, readyCount } = await settleAnswers(userId, resolved, "await");

    return { answers: resolved, applicationIds, readyCount };
  }

  function dismiss(userId: string, reviewId: string) {
    const review = db
      .select({ id: reviews.id, questionId: reviews.questionId })
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.userId, userId), eq(reviews.status, "open")))
      .get();

    if (review === undefined) {
      return null;
    }

    const applicationIds = applicationIdsForReview(db, reviewId);

    for (const applicationId of applicationIds) {
      const application = db
        .select({
          stage: applications.stage,
          status: applications.status,
          userId: applications.userId,
        })
        .from(applications)
        .where(eq(applications.id, applicationId))
        .get();

      db.update(applications)
        .set({
          status: "skipped",
          statusReason: "review_dismissed",
          stage: null,
          updatedAt: clock.now(),
        })
        .where(eq(applications.id, applicationId))
        .run();

      if (application !== undefined) {
        recordApplicationEvent(db, clock, {
          applicationId,
          fromValue: application.status,
          kind: "status",
          reason: "review_dismissed",
          source: "user",
          toValue: "skipped",
          userId: application.userId,
        });
        recordApplicationEvent(db, clock, {
          applicationId,
          fromValue: application.stage,
          kind: "stage",
          reason: "review_dismissed",
          source: "user",
          toValue: null,
          userId: application.userId,
        });
      }
    }

    db.update(reviews)
      .set({ status: "dismissed", resolvedAt: clock.now() })
      .where(eq(reviews.id, reviewId))
      .run();

    recordReviewResolved(db, clock, {
      questionId: review.questionId,
      resolution: "dismissed",
      reviewId,
      userId,
    });

    publishEvent(db, clock, "review.resolved", JSON.stringify({ reviewId }), userId);
    publishEvent(db, clock, "home.updated", JSON.stringify({ reviewId }), userId);

    return { reviewId, applicationIds };
  }

  return {
    answer,
    answerMany,
    dismiss,
    list: (userId: string) => listReviews({ catalogDb, clock, db, userId }),
  };
}

export type ReviewService = ReturnType<typeof createReviewService>;
