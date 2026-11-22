import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { BillingWindow, Payments } from "../platform/ports/payments.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { raiseAlert } from "../platform/alerts.ts";
import { billingReconciliations, grants, ledger, users } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { refundsRecordedBetween } from "./refunds.ts";
import { reconcileItemSchema, reconciliationItems } from "./reconcile-items.ts";
import type { ReconcileItem } from "./reconcile-items.ts";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** The daily check runs this long after UTC midnight, so the day before it is closed. */
export const BILLING_RECONCILE_DELAY_MS = 10 * 60_000;

const WINDOW_SLACK_MS = 6 * HOUR_MS;

/** How many mismatches one day's stored detail keeps; the count always keeps them all. */
export const MAX_STORED_MISMATCHES = 50;

export const BILLING_RECONCILE_JOB_KIND = "billing.reconcile";

export const RECONCILE_MISMATCH_KINDS = [
  "invoice_without_grant",
  "grant_without_invoice",
  "refund_without_ledger",
  "ledger_without_refund",
  "refund_ledger_missing",
] as const;

export type ReconcileMismatchKind = (typeof RECONCILE_MISMATCH_KINDS)[number];

export interface ReconcileMismatch {
  kind: ReconcileMismatchKind;
  /** The invoice, grant or refund id that does not line up. */
  id: string;
  amountCents: number | null;
}

export interface ReconcileRecord {
  day: string;
  status: "clean" | "mismatch";
  checkedAt: number;
  windowStart: number;
  windowEnd: number;
  stripeInvoices: number;
  stripeRefunds: number;
  ledgerGrants: number;
  ledgerRefunds: number;
  mismatchTotal: number;
  mismatches: ReconcileMismatch[];
  /** Paid invoices that have a matching grant. */
  matched: number;
  /** Paid invoices with no grant in Overture. */
  unrecorded: number;
  itemsTotal: number;
  items: ReconcileItem[];
}

const mismatchSchema = z.object({
  amountCents: z.number().nullable(),
  id: z.string(),
  kind: z.enum(RECONCILE_MISMATCH_KINDS),
});

const detailSchema = z.object({
  items: z.array(reconcileItemSchema).default([]),
  itemsTotal: z.number().int().nonnegative().default(0),
  matched: z.number().int().nonnegative().default(0),
  mismatchTotal: z.number().int().nonnegative().default(0),
  mismatches: z.array(mismatchSchema).default([]),
  unrecorded: z.number().int().nonnegative().default(0),
});

const windowPayloadSchema = z.object({
  sinceMs: z.number().int().optional(),
  untilMs: z.number().int().optional(),
});

function utcDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The UTC day before `nowMs`, as the half-open window the daily check reads.
 * @param nowMs The epoch-millisecond time the window is relative to.
 * @returns The window from the previous midnight to the last one.
 */
export function previousUtcDay(nowMs: number) {
  const untilMs = nowMs - (nowMs % DAY_MS);

  return { sinceMs: untilMs - DAY_MS, untilMs };
}

/**
 * The window a job payload names, or the previous UTC day when it names none.
 * @param payload The job payload JSON.
 * @param nowMs The clock's now, used when the payload names no window.
 * @returns The window to reconcile.
 */
export function windowFromPayload(payload: string, nowMs: number) {
  const parsed = windowPayloadSchema.parse(JSON.parse(payload));

  if (parsed.sinceMs === undefined && parsed.untilMs === undefined) {
    return previousUtcDay(nowMs);
  }

  if (parsed.sinceMs === undefined || parsed.untilMs === undefined) {
    throw new Error("A reconciliation window needs both sinceMs and untilMs.");
  }

  if (parsed.untilMs <= parsed.sinceMs) {
    throw new Error("A reconciliation window must end after it starts.");
  }

  return { sinceMs: parsed.sinceMs, untilMs: parsed.untilMs };
}

function inWindow(atMs: number, window: BillingWindow) {
  return atMs >= window.sinceMs && atMs < window.untilMs;
}

function widened(window: BillingWindow) {
  return { sinceMs: window.sinceMs - WINDOW_SLACK_MS, untilMs: window.untilMs + WINDOW_SLACK_MS };
}

function compareMismatches(left: ReconcileMismatch, right: ReconcileMismatch) {
  return left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}

function refundLedgerKeys(db: AppDatabase, refundKeys: readonly string[]) {
  if (refundKeys.length === 0) {
    return new Set<string>();
  }

  return new Set(
    db
      .select({ idempotencyKey: ledger.idempotencyKey })
      .from(ledger)
      .where(and(eq(ledger.kind, "refund"), inArray(ledger.idempotencyKey, refundKeys)))
      .all()
      .map((row) => row.idempotencyKey),
  );
}

/**
 * Compares Stripe's paid invoices and refunds for a window against the
 * ledger's period grants and refunds, stores the day's result and alerts the
 * owner only when something does not line up.
 *
 * The provider is read with a little slack on each edge, so an invoice paid
 * just before midnight and granted just after it always matches; the slack
 * only widens the membership checks, never the day's counts.
 * @param deps The database, clock and payment provider.
 * @param window The half-open window to reconcile.
 * @returns The day's result, with at most {@link MAX_STORED_MISMATCHES} mismatches kept.
 */
export async function runBillingReconciliation(
  deps: { db: AppDatabase; clock: Clock; payments: Payments },
  window: BillingWindow,
) {
  const { db, clock, payments } = deps;
  const readWindow = widened(window);

  const [providerInvoices, providerRefunds] = await Promise.all([
    payments.listPaidInvoices(readWindow),
    payments.listRefunds(readWindow),
  ]);

  const invoices = providerInvoices.filter((invoice) => inWindow(invoice.paidAtMs, window));

  const providerRefundsInDay = providerRefunds.filter((refund) =>
    inWindow(refund.createdAtMs, window),
  );

  const reportedInvoiceIds = new Set(providerInvoices.map((invoice) => invoice.invoiceId));
  const reportedRefundIds = new Set(providerRefunds.map((refund) => refund.refundId));

  const periodGrants = db
    .select()
    .from(grants)
    .where(and(eq(grants.source, "period"), isNotNull(grants.stripeInvoiceId)))
    .all();

  const grantedInvoiceIds = new Set(
    periodGrants.flatMap((grant) =>
      grant.stripeInvoiceId === null ? [] : [grant.stripeInvoiceId],
    ),
  );

  const grantsInDay = periodGrants.filter((grant) => inWindow(grant.createdAt, window));

  const checked = reconciliationItems({
    grantsByInvoice: new Map(
      periodGrants.flatMap((grant) =>
        grant.stripeInvoiceId === null
          ? []
          : [[grant.stripeInvoiceId, { userId: grant.userId }] as const],
      ),
    ),
    invoices,
    unmatchedGrants: grantsInDay.flatMap((grant) =>
      grant.stripeInvoiceId === null || reportedInvoiceIds.has(grant.stripeInvoiceId)
        ? []
        : [{ invoiceId: grant.stripeInvoiceId, userId: grant.userId }],
    ),
  });

  const storedRefunds = refundsRecordedBetween(db, readWindow);
  const storedRefundsInDay = storedRefunds.filter((refund) => inWindow(refund.at, window));
  const storedRefundIds = new Set(storedRefunds.map((refund) => refund.refundId));

  const withLedger = refundLedgerKeys(
    db,
    storedRefunds.map((refund) => refund.refundKey),
  );

  const mismatches: ReconcileMismatch[] = [];

  for (const invoice of invoices) {
    if (!grantedInvoiceIds.has(invoice.invoiceId)) {
      mismatches.push({
        amountCents: invoice.amountPaidCents,
        id: invoice.invoiceId,
        kind: "invoice_without_grant",
      });
    }
  }

  for (const grant of grantsInDay) {
    if (grant.stripeInvoiceId !== null && !reportedInvoiceIds.has(grant.stripeInvoiceId)) {
      mismatches.push({
        amountCents: null,
        id: grant.stripeInvoiceId,
        kind: "grant_without_invoice",
      });
    }
  }

  for (const refund of providerRefundsInDay) {
    if (!storedRefundIds.has(refund.refundId)) {
      mismatches.push({
        amountCents: refund.amountCents,
        id: refund.refundId,
        kind: "refund_without_ledger",
      });
    }
  }

  for (const refund of storedRefundsInDay) {
    if (!reportedRefundIds.has(refund.refundId)) {
      mismatches.push({
        amountCents: refund.amountCents,
        id: refund.refundId,
        kind: "ledger_without_refund",
      });
    }

    if (!withLedger.has(refund.refundKey)) {
      mismatches.push({
        amountCents: refund.amountCents,
        id: refund.refundKey,
        kind: "refund_ledger_missing",
      });
    }
  }

  mismatches.sort(compareMismatches);

  const result = {
    checkedAt: clock.now(),
    day: utcDay(window.sinceMs),
    ledgerGrants: grantsInDay.length,
    items: checked.items,
    itemsTotal: checked.itemsTotal,
    ledgerRefunds: storedRefundsInDay.length,
    matched: checked.matched,
    mismatchTotal: mismatches.length,
    mismatches: mismatches.slice(0, MAX_STORED_MISMATCHES),
    status: mismatches.length === 0 ? "clean" : "mismatch",
    stripeInvoices: invoices.length,
    stripeRefunds: providerRefundsInDay.length,
    unrecorded: checked.unrecorded,
    windowEnd: window.untilMs,
    windowStart: window.sinceMs,
  } satisfies ReconcileRecord;

  const alreadyAlerted =
    db
      .select({ status: billingReconciliations.status })
      .from(billingReconciliations)
      .where(eq(billingReconciliations.day, result.day))
      .get()?.status === "mismatch";

  recordReconciliation(db, result);

  if (result.status === "mismatch" && !alreadyAlerted) {
    raiseAlert(db, clock, "billing.mismatch", {
      day: result.day,
      invoices: result.stripeInvoices,
      kinds: [...new Set(mismatches.map((mismatch) => mismatch.kind))].toSorted().join(","),
      ledgerGrants: result.ledgerGrants,
      ledgerRefunds: result.ledgerRefunds,
      mismatches: result.mismatchTotal,
      refunds: result.stripeRefunds,
    });
  }

  return result;
}

/**
 * Stores one day's reconciliation, replacing the day's earlier result so a
 * re-run after a provider retry leaves a single row per day.
 * @param db The application database.
 * @param result The day's result.
 * @returns Nothing.
 */
export function recordReconciliation(db: AppDatabase, result: ReconcileRecord) {
  const updates = {
    checkedAt: result.checkedAt,
    detail: JSON.stringify({
      items: result.items,
      itemsTotal: result.itemsTotal,
      matched: result.matched,
      mismatchTotal: result.mismatchTotal,
      mismatches: result.mismatches,
      unrecorded: result.unrecorded,
    }),
    ledgerGrants: result.ledgerGrants,
    ledgerRefunds: result.ledgerRefunds,
    mismatches: result.mismatchTotal,
    status: result.status,
    stripeInvoices: result.stripeInvoices,
    stripeRefunds: result.stripeRefunds,
    windowEnd: result.windowEnd,
    windowStart: result.windowStart,
  };

  db.insert(billingReconciliations)
    .values({ ...updates, day: result.day })
    .onConflictDoUpdate({ set: updates, target: billingReconciliations.day })
    .run();
}

/**
 * The most recent reconciliation days, newest first.
 * @param db The application database.
 * @param limit How many days to return.
 * @returns The stored results, each with its parsed mismatch detail.
 */
export function readReconciliationDays(db: AppDatabase, limit: number) {
  return db
    .select()
    .from(billingReconciliations)
    .orderBy(desc(billingReconciliations.day))
    .limit(limit)
    .all()
    .map((row) => {
      const detail = detailSchema.parse(JSON.parse(row.detail));

      return {
        checkedAt: row.checkedAt,
        day: row.day,
        items: detail.items,
        itemsTotal: detail.itemsTotal,
        ledgerGrants: row.ledgerGrants,
        ledgerRefunds: row.ledgerRefunds,
        matched: detail.matched,
        mismatchTotal: row.mismatches,
        mismatches: detail.mismatches,
        unrecorded: detail.unrecorded,
        status: row.status,
        stripeInvoices: row.stripeInvoices,
        stripeRefunds: row.stripeRefunds,
        windowEnd: row.windowEnd,
        windowStart: row.windowStart,
      };
    });
}

/**
 * The last reconciliation the daily job stored.
 * @param db The application database.
 * @returns The newest stored result, or null before the first run.
 */
export function latestReconciliation(db: AppDatabase) {
  return readReconciliationDays(db, 1)[0] ?? null;
}

/**
 * The last reconciliation with each checked payment's owner looked up, for the
 * admin page. The owner is null for a payment with no Overture grant.
 * @param db The application database.
 * @returns The newest stored result with owners in place of user ids, or null before the first run.
 */
export function reconciliationForAdmin(db: AppDatabase) {
  const reconciliation = latestReconciliation(db);

  if (reconciliation === null) {
    return null;
  }

  const ownerIds = [
    ...new Set(reconciliation.items.flatMap((item) => (item.userId === null ? [] : [item.userId]))),
  ];

  const owners = new Map(
    ownerIds.length === 0
      ? []
      : db
          .select({ email: users.email, id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ownerIds))
          .all()
          .map((row) => [row.id, { email: row.email, name: row.name }] as const),
  );

  return {
    ...reconciliation,
    items: reconciliation.items.map((item) => ({
      amountCents: item.amountCents,
      id: item.id,
      owner: item.userId === null ? null : (owners.get(item.userId) ?? null),
      result: item.result,
    })),
  };
}

/**
 * Queues the next daily reconciliation. One run covers every user, so the job
 * is a singleton and a restart only replaces a queued copy.
 * @param db The application database.
 * @param clock The clock the pass runs against.
 * @returns Whether a new job was queued.
 */
export function ensureReconcileQueued(db: AppDatabase, clock: Clock) {
  const now = clock.now();
  const nextMidnight = now - (now % DAY_MS) + DAY_MS;

  return enqueueJob(db, clock, BILLING_RECONCILE_JOB_KIND, "{}", {
    dedupeKey: BILLING_RECONCILE_JOB_KIND,
    maxAttempts: 3,
    runAt: nextMidnight + BILLING_RECONCILE_DELAY_MS,
  }).inserted;
}

/**
 * The daily job: reconciles the window the payload names (the previous UTC day
 * by default), then queues the next run whatever the result.
 * @param deps The database, clock and payment provider.
 * @param payload The job payload JSON.
 */
export async function billingReconcileJobHandler(
  deps: { db: AppDatabase; clock: Clock; payments: Payments },
  payload: string,
) {
  try {
    await runBillingReconciliation(deps, windowFromPayload(payload, deps.clock.now()));
  } finally {
    ensureReconcileQueued(deps.db, deps.clock);
  }
}
