import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "./personal-crypto.ts";
import type { ReviewService } from "../pipeline/reviews.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";

import { applications, reviewApplications, reviews } from "../platform/db/schema.ts";
import { createFactService } from "./facts.ts";
import { factLabelFor, isTier2FactKey } from "../../shared/facts.ts";

const optionsSchema = z.array(z.string());

export interface StrengthenFactView {
  key: string;
  label: string;
  prompt: string;
  fieldType: QuestionFieldType;
  options: string[];
  unlocked: number;
}

export interface StrengthenView {
  facts: StrengthenFactView[];
  unlocks: number;
}

interface Candidate {
  prompt: string;
  fieldType: QuestionFieldType;
  options: string[];
  createdAt: number;
  reviewId: string;
  applicationIds: Set<string>;
}

function openReviewRows(db: AppDatabase, userId: string) {
  return db
    .select({
      applicationId: reviewApplications.applicationId,
      createdAt: reviews.createdAt,
      factKey: reviews.factKey,
      fieldType: reviews.fieldType,
      options: reviews.options,
      prompt: reviews.prompt,
      reviewId: reviews.id,
    })
    .from(reviews)
    .innerJoin(reviewApplications, eq(reviewApplications.reviewId, reviews.id))
    .innerJoin(applications, eq(applications.id, reviewApplications.applicationId))
    .where(
      and(eq(reviews.userId, userId), eq(reviews.status, "open"), eq(applications.stage, "queued")),
    )
    .all();
}

function strongest(left: Candidate, right: Candidate) {
  return (
    right.applicationIds.size - left.applicationIds.size ||
    left.createdAt - right.createdAt ||
    left.reviewId.localeCompare(right.reviewId)
  );
}

export function strengthenFactsFrom(
  rows: readonly {
    applicationId: string;
    createdAt: number;
    factKey: string | null;
    fieldType: QuestionFieldType;
    options: string;
    prompt: string;
    reviewId: string;
  }[],
  answered: ReadonlySet<string>,
) {
  const byKey = new Map<string, Map<string, Candidate>>();

  for (const row of rows) {
    if (row.factKey === null || !isTier2FactKey(row.factKey)) {
      continue;
    }

    const candidates = byKey.get(row.factKey) ?? new Map<string, Candidate>();

    const existing = candidates.get(row.reviewId) ?? {
      applicationIds: new Set<string>(),
      createdAt: row.createdAt,
      fieldType: row.fieldType,
      options: optionsSchema.parse(JSON.parse(row.options)),
      prompt: row.prompt,
      reviewId: row.reviewId,
    };

    existing.applicationIds.add(row.applicationId);
    candidates.set(row.reviewId, existing);
    byKey.set(row.factKey, candidates);
  }

  const unlockedBy = new Set<string>();
  const facts: StrengthenFactView[] = [];

  for (const [key, candidates] of byKey) {
    if (answered.has(key)) {
      continue;
    }

    const best = [...candidates.values()].toSorted(strongest).at(0);

    if (best === undefined) {
      continue;
    }

    const unlocked = new Set<string>();

    for (const candidate of candidates.values()) {
      for (const applicationId of candidate.applicationIds) {
        unlocked.add(applicationId);
      }
    }

    for (const applicationId of unlocked) {
      unlockedBy.add(applicationId);
    }

    facts.push({
      fieldType: best.fieldType,
      key,
      label: factLabelFor(key) ?? key,
      options: best.options,
      prompt: best.prompt,
      unlocked: unlocked.size,
    });
  }

  return {
    facts: facts.toSorted(
      (left, right) =>
        right.unlocked - left.unlocked ||
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key),
    ),
    unlocks: unlockedBy.size,
  } satisfies StrengthenView;
}

export function createStrengthenService(deps: {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
  reviewService: ReviewService;
}) {
  const { db, clock, personal, reviewService } = deps;

  const factsService = createFactService({ db, clock, personal });

  async function read(userId: string) {
    const saved = await factsService.list(userId);

    return strengthenFactsFrom(
      openReviewRows(db, userId),
      new Set(saved.filter((fact) => fact.scope === "").map((fact) => fact.key)),
    );
  }

  async function save(userId: string, key: string, value: string) {
    const saved = await factsService.save(userId, key, value, "");

    const open = db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.factKey, key), eq(reviews.status, "open")))
      .all();

    await Promise.all(
      open.map(async (review) => {
        await reviewService.answer(userId, review.id, saved.value, {
          fact: { key, scope: "" },
          prepare: "enqueue",
        });
      }),
    );

    return read(userId);
  }

  return { read, save };
}

export type StrengthenService = ReturnType<typeof createStrengthenService>;
