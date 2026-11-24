import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { applications, attempts, users } from "../platform/db/schema.ts";

import { applicationLlmMicrosByUser } from "./application-spend.ts";
import { isAttempted } from "./report.ts";

/**
 * The actual variable cost of one Application, split the way the admin margin
 * view reads it (ADR 0041, issue #570): the try that sent the Application, the
 * other attempted tries on the way there, and the Application-purpose model
 * spend attributed to it.
 */
export interface RecordedApplicationCost {
  applications: number;
  llmMicros: number;
  browserMicros: number;
  retryMicros: number;
}

/**
 * The three components together: what one completed Application actually cost.
 * @param cost The stored totals for one or more Applications.
 * @returns The total variable cost in micros.
 */
export function recordedCostTotal(cost: RecordedApplicationCost) {
  return cost.llmMicros + cost.browserMicros + cost.retryMicros;
}

interface AttemptCostRow {
  applicationId: string;
  costMicros: number | null;
  id: string;
  outcome: string | null;
  startedAt: number;
  submitClickedAt: number | null;
}

function sendingAttemptId(rows: AttemptCostRow[], sent: boolean) {
  if (!sent) {
    return null;
  }

  const attempted = rows.filter((row) => isAttempted(row.outcome));
  const submitted = attempted.filter((row) => row.submitClickedAt !== null);

  return submitted.at(-1)?.id ?? attempted.at(-1)?.id ?? null;
}

/**
 * Recompute one person's stored per-Application variable costs from the real
 * execution metrics: `attempts.cost_micros` for browser spend and `llm_usage`
 * for model spend. It is idempotent: the same data always writes the same
 * numbers and unchanged rows are not touched.
 *
 * The sending try's browser spend is `browser_cost_micros`; every other
 * attempted try is `retry_cost_micros`, so a retry never double counts the
 * send. `llm_usage` has no Application id (SPEC §10.4), so the person's actual
 * Application-purpose model spend is split evenly across their completed
 * Applications, with the remainder going to the oldest ones so the stored parts
 * always add up to the real total.
 * @param db The database to read and write.
 * @param input The person whose Applications to refresh, and the instant to stamp.
 * @returns How many Application rows changed.
 */
export function recordApplicationVariableCosts(
  db: AppDatabase,
  input: { at: number; userId: string },
) {
  const apps = db
    .select({
      browserCostMicros: applications.browserCostMicros,
      costRecordedAt: applications.costRecordedAt,
      id: applications.id,
      llmCostMicros: applications.llmCostMicros,
      retryCostMicros: applications.retryCostMicros,
      sentAt: applications.sentAt,
      status: applications.status,
    })
    .from(applications)
    .where(eq(applications.userId, input.userId))
    .orderBy(applications.sentAt, applications.id)
    .all();

  if (apps.length === 0) {
    return 0;
  }

  const attemptRows = db
    .select({
      applicationId: attempts.applicationId,
      costMicros: attempts.costMicros,
      id: attempts.id,
      outcome: attempts.outcome,
      startedAt: attempts.startedAt,
      submitClickedAt: attempts.submitClickedAt,
    })
    .from(attempts)
    .where(eq(attempts.userId, input.userId))
    .orderBy(attempts.startedAt, attempts.id)
    .all();

  const byApplication = new Map<string, AttemptCostRow[]>();

  for (const row of attemptRows) {
    const rows = byApplication.get(row.applicationId) ?? [];

    rows.push(row);
    byApplication.set(row.applicationId, rows);
  }

  const completed = apps.filter((app) => app.status === "sent");
  const llmTotal = applicationLlmMicrosByUser(db, null).get(input.userId) ?? 0;
  const share = completed.length === 0 ? 0 : Math.floor(llmTotal / completed.length);
  const remainder = llmTotal - share * completed.length;
  const llmByApplication = new Map<string, number>();

  for (const [index, app] of completed.entries()) {
    llmByApplication.set(app.id, share + (index < remainder ? 1 : 0));
  }

  let updated = 0;

  for (const app of apps) {
    const rows = byApplication.get(app.id) ?? [];
    const sending = sendingAttemptId(rows, app.status === "sent");

    let browserMicros = 0;
    let retryMicros = 0;

    for (const row of rows) {
      if (!isAttempted(row.outcome)) {
        continue;
      }

      const costMicros = row.costMicros ?? 0;

      if (sending !== null && row.id === sending) {
        browserMicros += costMicros;
      } else {
        retryMicros += costMicros;
      }
    }

    const llmMicros = llmByApplication.get(app.id) ?? 0;

    if (rows.length === 0 && llmMicros === 0) {
      continue;
    }

    const unchanged =
      app.browserCostMicros === browserMicros &&
      app.retryCostMicros === retryMicros &&
      app.llmCostMicros === llmMicros &&
      app.costRecordedAt !== null;

    if (unchanged) {
      continue;
    }

    db.update(applications)
      .set({
        browserCostMicros: browserMicros,
        costRecordedAt: input.at,
        llmCostMicros: llmMicros,
        retryCostMicros: retryMicros,
      })
      .where(eq(applications.id, app.id))
      .run();

    updated += 1;
  }

  return updated;
}

/**
 * Stored variable cost per person for the completed Applications they sent in
 * the window. Only Applications whose cost was measured count: a row that
 * predates the recording columns, or that never finished a try, is left out
 * rather than averaged in as a fake zero.
 * @param db The database to read.
 * @param sinceMs The earliest `sent_at` in the window.
 * @returns The totals keyed by user id.
 */
export function recordedApplicationCostsByUser(db: AppDatabase, sinceMs: number) {
  const rows = db
    .select({
      applications: sql<number>`count(*)`,
      browserMicros: sql<number>`coalesce(sum(${applications.browserCostMicros}), 0)`,
      llmMicros: sql<number>`coalesce(sum(${applications.llmCostMicros}), 0)`,
      retryMicros: sql<number>`coalesce(sum(${applications.retryCostMicros}), 0)`,
      userId: applications.userId,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(
      and(
        sql`${users.role} <> 'demo'`,
        eq(applications.status, "sent"),
        isNotNull(applications.sentAt),
        gte(applications.sentAt, sinceMs),
        isNotNull(applications.costRecordedAt),
      ),
    )
    .groupBy(applications.userId)
    .all();

  return new Map(
    rows.map((row) => [
      row.userId,
      {
        applications: row.applications,
        browserMicros: row.browserMicros,
        llmMicros: row.llmMicros,
        retryMicros: row.retryMicros,
      } satisfies RecordedApplicationCost,
    ]),
  );
}
