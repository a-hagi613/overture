import { createHash } from "node:crypto";

import { count, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import {
  applicationSnapshots,
  applications,
  questions,
  reviewAuditEvents,
} from "../platform/db/schema.ts";
import { reviewCategory } from "../catalog/question-normalize.ts";

const detailSchema = z.object({
  reason: z.string().optional(),
  repeat: z.boolean().optional(),
  resolution: z.string().optional(),
});

const snapshotAnswerSchema = z.object({
  answer: z.string().nullable(),
  fact_key: z.string().nullable(),
  fact_revision: z.number().nullable(),
  kind: z.string(),
  label: z.string(),
  question_id: z.string(),
});

const snapshotAnswersSchema = z.array(snapshotAnswerSchema);

function factualSource(kind: string) {
  if (kind === "fact") {
    return "fact";
  }

  if (kind === "target" || kind === "derived") {
    return "derivation";
  }

  if (kind === "consent") {
    return "consent_allowlist";
  }

  return null;
}

export const DEFAULT_AUDIT_SAMPLE = 20;
export const DEFAULT_AUDIT_SEED = "review-audit-v1";

export interface ReviewReportAts {
  ats: string;
  prepared: number;
  reviews: number;
  sent: number;
  reviewsPer100: number | null;
}

export interface ReviewReportFamily {
  questionId: string;
  textNormHash: string;
  prompt: string;
  category: string;
  reviews: number;
  repeats: number;
}

export interface ReviewReport {
  since: number | null;
  prepared: number;
  reviews: number;
  sent: number;
  reviewsPer100: number | null;
  repeatRate: number | null;
  coverage: number | null;
  byAts: ReviewReportAts[];
  questionFamilies: ReviewReportFamily[];
  answersBySource: { source: string; answers: number }[];
  resolutions: {
    answered: number;
    dismissed: number;
    autoDismissed: number;
    medianAnswerMs: number | null;
  };
}

export interface SnapshotAuditAnswer {
  label: string;
  kind: string;
  source: string;
  factKey: string | null;
  factRevision: number | null;
  value: string | null;
}

export interface SnapshotAuditEntry {
  applicationId: string;
  ats: string;
  company: string;
  postingTitle: string;
  submittedAt: number;
  confirmedBy: string;
  answers: SnapshotAuditAnswer[];
}

export interface SnapshotAudit {
  seed: string;
  sample: number;
  selected: number;
  snapshots: SnapshotAuditEntry[];
}

export interface AuditOptions {
  since: number | null;
  sample: number;
  seed: string;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function median(values: readonly number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function reviewReportRows(db: AppDatabase, since: number | null) {
  return db
    .select({
      at: reviewAuditEvents.at,
      ats: reviewAuditEvents.ats,
      detail: reviewAuditEvents.detail,
      kind: reviewAuditEvents.kind,
      questionId: reviewAuditEvents.questionId,
      reviewId: reviewAuditEvents.reviewId,
      source: reviewAuditEvents.source,
    })
    .from(reviewAuditEvents)
    .where(since === null ? undefined : gte(reviewAuditEvents.at, since))
    .all();
}

function preparedApplications(db: AppDatabase, since: number | null) {
  return db
    .select({ ats: applications.ats, total: count() })
    .from(applications)
    .where(since === null ? undefined : gte(applications.createdAt, since))
    .groupBy(applications.ats)
    .all();
}

function groupCount<T extends string>(values: readonly T[]) {
  const counts = new Map<T, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function parseDetail(value: string) {
  const parsed = detailSchema.safeParse(JSON.parse(value));

  return parsed.success ? parsed.data : {};
}

export function buildReviewReport(db: AppDatabase, options: { since: number | null }) {
  const rows = reviewReportRows(db, options.since);

  const opened = rows.filter((row) => row.kind === "review_opened");
  const resolved = rows.filter((row) => row.kind === "review_resolved");
  const answered = rows.filter((row) => row.kind === "auto_answer");
  const sent = rows.filter((row) => row.kind === "snapshot_sent");

  const openedIds = new Set(opened.flatMap((row) => (row.reviewId === null ? [] : [row.reviewId])));

  const openedAt = new Map<string, number>();

  for (const row of opened) {
    if (row.reviewId !== null) {
      openedAt.set(row.reviewId, row.at);
    }
  }

  const repeats = opened.filter((row) => parseDetail(row.detail).repeat === true).length;

  const resolutions = { answered: 0, autoDismissed: 0, dismissed: 0 };

  const answerTimes: number[] = [];

  for (const row of resolved) {
    if (row.reviewId === null || !openedIds.has(row.reviewId)) {
      continue;
    }

    const detail = parseDetail(row.detail);

    if (detail.resolution === "answered") {
      resolutions.answered += 1;

      const openedTime = openedAt.get(row.reviewId);

      if (openedTime !== undefined) {
        answerTimes.push(row.at - openedTime);
      }
    } else if (detail.resolution === "dismissed") {
      resolutions.dismissed += 1;
    } else if (detail.resolution === "auto_dismissed") {
      resolutions.autoDismissed += 1;
    }
  }

  const prepared = preparedApplications(db, options.since);

  const preparedByAts = new Map<string, number>();

  for (const row of prepared) {
    preparedByAts.set(row.ats ?? "unknown", row.total);
  }

  const reviewsByAts = groupCount(
    opened.flatMap((row) => (row.ats === null ? ["unknown"] : [row.ats])),
  );

  const sentByAts = groupCount(sent.flatMap((row) => (row.ats === null ? ["unknown"] : [row.ats])));

  const atsNames = new Set([...preparedByAts.keys(), ...reviewsByAts.keys(), ...sentByAts.keys()]);

  const byAts: ReviewReportAts[] = [...atsNames]
    .map((ats) => {
      const preparedCount = preparedByAts.get(ats) ?? 0;
      const reviewCount = reviewsByAts.get(ats) ?? 0;

      return {
        ats,
        prepared: preparedCount,
        reviews: reviewCount,
        reviewsPer100: ratio(reviewCount * 100, preparedCount),
        sent: sentByAts.get(ats) ?? 0,
      };
    })
    .toSorted((left, right) => left.ats.localeCompare(right.ats));

  const totalPrepared = [...preparedByAts.values()].reduce((total, value) => total + value, 0);

  const sourceCounts = groupCount(
    answered.flatMap((row) => (row.source === null ? ["unknown"] : [row.source])),
  );

  return {
    answersBySource: [...sourceCounts.entries()]
      .map(([source, answers]) => ({ answers, source }))
      .toSorted((left, right) => left.source.localeCompare(right.source)),
    byAts,
    coverage: ratio(sent.length, totalPrepared),
    prepared: totalPrepared,
    questionFamilies: questionFamilies(db, opened),
    repeatRate: ratio(repeats, opened.length),
    resolutions: { ...resolutions, medianAnswerMs: median(answerTimes) },
    reviews: opened.length,
    reviewsPer100: ratio(opened.length * 100, totalPrepared),
    sent: sent.length,
    since: options.since,
  };
}

function questionFamilies(
  db: AppDatabase,
  opened: readonly { questionId: string | null; detail: string }[],
) {
  const grouped = new Map<string, { reviews: number; repeats: number }>();

  for (const row of opened) {
    if (row.questionId === null) {
      continue;
    }

    const entry = grouped.get(row.questionId) ?? { repeats: 0, reviews: 0 };

    entry.reviews += 1;

    if (parseDetail(row.detail).repeat === true) {
      entry.repeats += 1;
    }

    grouped.set(row.questionId, entry);
  }

  const ids = [...grouped.keys()];

  if (ids.length === 0) {
    return [];
  }

  const rows = db
    .select({
      factKey: questions.factKey,
      id: questions.id,
      textDisplay: questions.textDisplay,
      textNormHash: questions.textNormHash,
    })
    .from(questions)
    .where(inArray(questions.id, ids))
    .all();

  const byId = new Map(rows.map((row) => [row.id, row]));

  return ids
    .map((id) => {
      const question = byId.get(id);
      const entry = grouped.get(id) ?? { repeats: 0, reviews: 0 };

      if (question === undefined) {
        return {
          category: "other",
          prompt: "",
          questionId: id,
          repeats: entry.repeats,
          reviews: entry.reviews,
          textNormHash: "",
        };
      }

      return {
        category: reviewCategory(question.textDisplay, question.factKey),
        prompt: question.textDisplay,
        questionId: id,
        repeats: entry.repeats,
        reviews: entry.reviews,
        textNormHash: question.textNormHash,
      };
    })
    .toSorted(
      (left, right) => right.reviews - left.reviews || left.prompt.localeCompare(right.prompt),
    );
}

function auditOrder(seed: string, applicationId: string) {
  return createHash("sha256").update(`${seed}:${applicationId}`).digest("hex");
}

export async function sampleSnapshotAudit(
  db: AppDatabase,
  personal: PersonalCrypto,
  options: AuditOptions,
) {
  const rows = db
    .select({
      answersEnc: applicationSnapshots.answersEnc,
      applicationId: applicationSnapshots.applicationId,
      ats: applications.ats,
      company: applications.companyName,
      confirmedBy: applicationSnapshots.confirmedBy,
      postingTitle: applicationSnapshots.postingTitle,
      submittedAt: applicationSnapshots.submittedAt,
      userId: applicationSnapshots.userId,
    })
    .from(applicationSnapshots)
    .innerJoin(applications, eq(applications.id, applicationSnapshots.applicationId))
    .where(
      options.since === null ? undefined : gte(applicationSnapshots.submittedAt, options.since),
    )
    .all();

  const chosen = rows
    .map((row) => ({ order: auditOrder(options.seed, row.applicationId), row }))
    .toSorted((left, right) => left.order.localeCompare(right.order))
    .slice(0, options.sample);

  const snapshots = await Promise.all(
    chosen.map(async ({ row }) => {
      const plaintext = await personal.openFor(
        row.userId,
        { column: "answers_enc", rowId: row.applicationId, table: "application_snapshots" },
        row.answersEnc,
      );

      const parsed = snapshotAnswersSchema.safeParse(JSON.parse(plaintext));
      const answers = parsed.success ? parsed.data : [];

      return {
        answers: answers.flatMap((answer) => {
          const source = factualSource(answer.kind);

          if (source === null) {
            return [];
          }

          return [
            {
              factKey: answer.fact_key,
              factRevision: answer.fact_revision,
              kind: answer.kind,
              label: answer.label,
              source,
              value: answer.answer,
            },
          ];
        }),
        applicationId: row.applicationId,
        ats: row.ats ?? "unknown",
        company: row.company,
        confirmedBy: row.confirmedBy,
        postingTitle: row.postingTitle,
        submittedAt: row.submittedAt,
      } satisfies SnapshotAuditEntry;
    }),
  );

  return {
    sample: options.sample,
    seed: options.seed,
    selected: snapshots.length,
    snapshots,
  };
}

export function redactSnapshotAudit(audit: SnapshotAudit) {
  return {
    sample: audit.sample,
    seed: audit.seed,
    selected: audit.selected,
    snapshots: audit.snapshots.map((snapshot) => ({
      applicationId: snapshot.applicationId,
      ats: snapshot.ats,
      company: snapshot.company,
      confirmedBy: snapshot.confirmedBy,
      postingTitle: snapshot.postingTitle,
      submittedAt: snapshot.submittedAt,
      answers: snapshot.answers.map((answer) => ({
        factKey: answer.factKey,
        factRevision: answer.factRevision,
        hasValue: answer.value !== null,
        kind: answer.kind,
        label: answer.label,
        source: answer.source,
      })),
    })),
  };
}
