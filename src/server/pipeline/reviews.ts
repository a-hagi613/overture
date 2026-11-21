import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { QuestionFieldType, ReviewCategory, ReviewReason } from "../../shared/questions.ts";
import type { PreparationService } from "./prepare.ts";

import {
  applications,
  companies,
  postings,
  reviewApplications,
  reviews,
} from "../platform/db/schema.ts";
import { createQuestionCatalog } from "../catalog/questions.ts";
import { countryNameFor } from "../catalog/geo.ts";
import { reviewCategory } from "../catalog/question-normalize.ts";
import { createFactService } from "../profile/facts.ts";
import { factLabelFor } from "../../shared/facts.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import {
  applicationIdsForReview,
  dismissEmptyReview,
  detachApplication,
  openReviewIds,
} from "./review-store.ts";
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
  createdAt: number;
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

function closedApplicationIds(db: AppDatabase, applicationIds: readonly string[]) {
  if (applicationIds.length === 0) {
    return new Set<string>();
  }

  return new Set(
    db
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .where(and(inArray(applications.id, [...applicationIds]), isNull(postings.closedAt)))
      .all()
      .map((row) => row.id),
  );
}

function attachmentsFor(db: AppDatabase, reviewId: string) {
  return db
    .select({
      applicationId: applications.id,
      company: companies.name,
      title: postings.title,
      postingId: postings.id,
    })
    .from(reviewApplications)
    .innerJoin(applications, eq(applications.id, reviewApplications.applicationId))
    .innerJoin(postings, eq(postings.id, applications.postingId))
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(eq(reviewApplications.reviewId, reviewId))
    .orderBy(applications.createdAt, applications.id)
    .all();
}

export function createReviewService(deps: {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
  preparation: PreparationService;
}) {
  const { db, clock, personal, preparation } = deps;

  const catalog = createQuestionCatalog({ db, clock });
  const factsService = createFactService({ db, clock, personal });

  function sweep(userId: string) {
    for (const reviewId of openReviewIds(db, userId)) {
      const attachments = attachmentsFor(db, reviewId);

      const open = closedApplicationIds(
        db,
        attachments.map((attachment) => attachment.applicationId),
      );

      for (const attachment of attachments) {
        if (!open.has(attachment.applicationId)) {
          detachApplication(db, reviewId, attachment.applicationId);
        }
      }

      dismissEmptyReview(db, clock, reviewId);
    }
  }

  function list(userId: string) {
    sweep(userId);

    const views: ReviewView[] = openReviewRows(db, userId).map((review) => {
      const attachments = attachmentsFor(db, review.id);
      const companiesUnlocked = new Set(attachments.map((attachment) => attachment.company));
      const label = review.factKey === null ? null : factLabelFor(review.factKey);
      const country = review.scope === "" ? null : countryNameFor(review.scope);

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
        category: reviewCategory(review.prompt, review.factKey),
        unlocked: attachments.length,
        companies: companiesUnlocked.size,
        applications: attachments,
        createdAt: review.createdAt,
      };
    });

    return views.toSorted(
      (left, right) => right.unlocked - left.unlocked || left.createdAt - right.createdAt,
    );
  }

  async function answer(
    userId: string,
    reviewId: string,
    value: string,
    options: {
      fact?: { key: string; scope: string };
      prepare?: "await" | "enqueue";
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

    if (target === null) {
      await factsService.saveFromReview(userId, factKey, value, review.scope);
    } else {
      await factsService.save(userId, factKey, value, scope);
    }

    catalog.setMapping(review.questionId, { answerKind: "fact", factKey, mappedBy: "owner" });

    const applicationIds = applicationIdsForReview(db, reviewId);

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

    await returnStaleApprovals({ clock, db, personal, userId });

    if (options.prepare === "enqueue") {
      for (const applicationId of applicationIds) {
        enqueueApplicationPrepare(db, clock, applicationId);
      }
    } else {
      await preparation.prepareMany(applicationIds);
    }

    publishEvent(db, clock, "review.resolved", JSON.stringify({ reviewId }), userId);
    publishEvent(db, clock, "home.updated", JSON.stringify({ reviewId }), userId);

    return { reviewId, factKey, scope, applicationIds };
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
      db.update(applications)
        .set({
          status: "skipped",
          statusReason: "review_dismissed",
          stage: null,
          updatedAt: clock.now(),
        })
        .where(eq(applications.id, applicationId))
        .run();
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

  return { answer, dismiss, list };
}

export type ReviewService = ReturnType<typeof createReviewService>;
