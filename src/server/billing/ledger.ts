import { and, asc, eq, exists, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type { Clock } from "../platform/ports/clock.ts";

import { applications, grants, ledger } from "../platform/db/schema.ts";

export type BillingDb = BaseSQLiteDatabase<"sync", void>;

type LedgerRow = typeof ledger.$inferSelect;

type LedgerKindPostable = Exclude<LedgerRow["kind"], "adjust">;

type LedgerAccount = LedgerRow["debitAccount"];

type ReservationsOf = (typeof ledger.$inferSelect)[];

export const LEDGER_ACCOUNTS = ["issued", "available", "reserved", "used", "expired"] as const;

export const LEDGER_TRANSFERS: Record<
  LedgerKindPostable,
  { credit: LedgerAccount; debit: LedgerAccount }
> = {
  commit: { credit: "used", debit: "reserved" },
  expire: { credit: "expired", debit: "available" },
  grant: { credit: "available", debit: "issued" },
  refund: { credit: "expired", debit: "available" },
  release: { credit: "available", debit: "reserved" },
  reserve: { credit: "reserved", debit: "available" },
};

export interface LedgerPostInput {
  userId: string;
  kind: LedgerKindPostable;
  amount: number;
  grantId: string;
  applicationId?: string | null;
  idempotencyKey: string;
}

export interface GrantInput {
  userId: string;
  source: "admin" | "period" | "trial";
  quantity: number;
  startsAt?: number | null;
  expiresAt?: number | null;
  stripeInvoiceId?: string | null;
  idempotencyKey: string;
}

export interface ReservationInput {
  userId: string;
  applicationId: string;
  idempotencyKey: string;
}

export interface LedgerBalances {
  issued: number;
  available: number;
  reserved: number;
  used: number;
  expired: number;
}

function balancesOfZero() {
  return { available: 0, expired: 0, issued: 0, reserved: 0, used: 0 } satisfies LedgerBalances;
}

export function postLedgerEntry(db: BillingDb, at: number, entry: LedgerPostInput) {
  const existing = entryOf(db, entry.idempotencyKey);

  if (existing !== undefined) {
    return existing;
  }

  const transfer = LEDGER_TRANSFERS[entry.kind];

  const row: LedgerRow = {
    id: crypto.randomUUID(),
    userId: entry.userId,
    kind: entry.kind,
    debitAccount: transfer.debit,
    creditAccount: transfer.credit,
    amount: entry.amount,
    grantId: entry.grantId,
    applicationId: entry.applicationId ?? null,
    idempotencyKey: entry.idempotencyKey,
    createdAt: at,
  };

  db.insert(ledger).values(row).run();

  return row;
}

function entryOf(db: BillingDb, idempotencyKey: string) {
  return db.select().from(ledger).where(eq(ledger.idempotencyKey, idempotencyKey)).get();
}

export function grantApplications(db: BillingDb, clock: Clock, input: GrantInput) {
  return db.transaction(
    (tx) => {
      const existing = entryOf(tx, input.idempotencyKey);

      if (existing !== undefined) {
        return { created: false, entry: existing, grantId: existing.grantId };
      }

      const at = clock.now();
      const grantId = crypto.randomUUID();

      tx.insert(grants)
        .values({
          id: grantId,
          userId: input.userId,
          source: input.source,
          quantity: input.quantity,
          startsAt: input.startsAt ?? at,
          expiresAt: input.expiresAt ?? null,
          stripeInvoiceId: input.stripeInvoiceId ?? null,
          createdAt: at,
        })
        .run();

      const entry = postLedgerEntry(tx, at, {
        userId: input.userId,
        kind: "grant",
        amount: input.quantity,
        grantId,
        applicationId: null,
        idempotencyKey: input.idempotencyKey,
      });

      return { created: true, entry, grantId };
    },
    { behavior: "immediate" },
  );
}

function grantHasBeenSpent(db: BillingDb, userId: string) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(ledger)
      .where(
        and(
          eq(ledger.userId, userId),
          eq(ledger.grantId, grants.id),
          inArray(ledger.kind, ["commit", "release", "reserve"]),
        ),
      ),
  );
}

export function activeGrantsOf(db: BillingDb, userId: string, at: number) {
  return db
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.userId, userId),
        or(lte(grants.startsAt, at), grantHasBeenSpent(db, userId)),
        or(isNull(grants.expiresAt), gt(grants.expiresAt, at)),
      ),
    )
    .orderBy(sql`${grants.expiresAt} is null`, asc(grants.expiresAt), asc(grants.id))
    .all();
}

export function balancesPerGrant(db: BillingDb, userId: string) {
  const balances = new Map<string, LedgerBalances>();
  const rows = db.select().from(ledger).where(eq(ledger.userId, userId)).all();

  for (const row of rows) {
    const per = balances.get(row.grantId) ?? balancesOfZero();

    per[row.debitAccount] -= row.amount;
    per[row.creditAccount] += row.amount;
    balances.set(row.grantId, per);
  }

  return balances;
}

export function ledgerBalances(db: BillingDb, userId: string) {
  const total = balancesOfZero();

  for (const per of balancesPerGrant(db, userId).values()) {
    for (const account of LEDGER_ACCOUNTS) {
      total[account] += per[account];
    }
  }

  return total;
}

export function applicationsLeft(db: BillingDb, userId: string, at: number) {
  return billingSummary(db, userId, at).applicationsLeft;
}

export function planApplications(db: BillingDb, userId: string, at: number) {
  return billingSummary(db, userId, at).planApplications;
}

/**
 * Whether a person is still on the one-time onboarding trial: an unspent
 * `trial` grant and no paid `period` grant. The trial's three Applications go
 * together, without the paid 5-minute spacing that applies after an upgrade.
 * @param db The billing database.
 * @param userId The person whose grants are read.
 * @param at The instant to read them at.
 * @returns True while the trial funds the person and no paid period does.
 */
export function isOnboardingTrial(db: BillingDb, userId: string, at: number) {
  const per = balancesPerGrant(db, userId);
  const active = activeGrantsOf(db, userId, at);

  const trialLeft = active.some(
    (grant) => grant.source === "trial" && (per.get(grant.id)?.available ?? 0) > 0,
  );

  if (!trialLeft) {
    return false;
  }

  return !active.some((grant) => grant.source === "period");
}

export function endingGrantOf(db: BillingDb, userId: string, at: number) {
  return billingSummary(db, userId, at).endingGrant;
}

/**
 * The person's billing strip: Applications left, the invite grant that is
 * running out, and the plan's size. One read of their grants and one of their
 * ledger serves all three; the soonest-ending admin grant with an end date and
 * Applications left is the one Home shows, so an invited user can choose a plan
 * before it ends.
 * @param db The database to read.
 * @param userId The person whose grants and ledger are read.
 * @param at The instant the summary is for.
 * @returns Applications left, the ending grant or null, and the plan's size.
 */
export function billingSummary(db: BillingDb, userId: string, at: number) {
  const per = balancesPerGrant(db, userId);
  const active = activeGrantsOf(db, userId, at);

  const left = active.reduce((sum, grant) => sum + (per.get(grant.id)?.available ?? 0), 0);
  const planSize = active.reduce((sum, grant) => sum + grant.quantity, 0);

  const ending = active.find(
    (row) =>
      row.source === "admin" && row.expiresAt !== null && (per.get(row.id)?.available ?? 0) > 0,
  );

  const expiresAt = ending?.expiresAt ?? null;
  const endingLeft = ending === undefined ? 0 : (per.get(ending.id)?.available ?? 0);

  return {
    applicationsLeft: left,
    endingGrant:
      ending === undefined || expiresAt === null || endingLeft === 0
        ? null
        : { applicationsLeft: endingLeft, expiresAt },
    planApplications: planSize,
  };
}

interface ReservationPair {
  reserve: LedgerRow;
  closedBy: LedgerRow | null;
}

function reservationPairsOf(db: BillingDb, userId: string) {
  const rows = db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), inArray(ledger.kind, ["commit", "release", "reserve"])))
    .orderBy(sql`rowid`)
    .all();

  const open = new Map<string, ReservationsOf>();
  const pairs: ReservationPair[] = [];

  for (const row of rows) {
    const openKey = `${row.grantId}\u0000${row.applicationId ?? ""}`;

    if (row.kind === "reserve") {
      const queue = open.get(openKey) ?? [];

      queue.push(row);
      open.set(openKey, queue);
      pairs.push({ closedBy: null, reserve: row });
      continue;
    }

    const queue = open.get(openKey);
    const target = queue?.shift();

    if (target !== undefined) {
      const pair = pairs.find((candidate) => candidate.reserve.id === target.id);

      if (pair !== undefined) {
        pair.closedBy = row;
      }
    }
  }

  return pairs;
}

function applicationInFlight(db: BillingDb, applicationId: string | null) {
  if (applicationId === null) {
    return false;
  }

  const row = db
    .select({ status: applications.status })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .get();

  return row?.status === "sending" || row?.status === "confirming";
}

function nextExpireKey(db: BillingDb, grantId: string) {
  const base = `expire:${grantId}`;

  if (entryOf(db, base) === undefined) {
    return base;
  }

  let sequence = 1;

  while (entryOf(db, `${base}:${String(sequence)}`) !== undefined) {
    sequence += 1;
  }

  return `${base}:${String(sequence)}`;
}

function openReservationOf(db: BillingDb, userId: string, applicationId: string) {
  const pair = reservationPairsOf(db, userId).find(
    (candidate) => candidate.closedBy === null && candidate.reserve.applicationId === applicationId,
  );

  return pair === undefined ? null : pair.reserve;
}

export function reserveForApplication(db: BillingDb, clock: Clock, input: ReservationInput) {
  const existing = entryOf(db, input.idempotencyKey);

  if (existing !== undefined) {
    return { grantId: existing.grantId, reserved: true as const, row: existing };
  }

  const at = clock.now();
  const per = balancesPerGrant(db, input.userId);

  const grant =
    activeGrantsOf(db, input.userId, at).find((candidate) => {
      const available = per.get(candidate.id)?.available ?? 0;

      return available > 0;
    }) ?? null;

  if (grant === null) {
    return { reserved: false as const };
  }

  const row = postLedgerEntry(db, at, {
    userId: input.userId,
    kind: "reserve",
    amount: 1,
    grantId: grant.id,
    applicationId: input.applicationId,
    idempotencyKey: input.idempotencyKey,
  });

  return { grantId: grant.id, reserved: true as const, row };
}

export function commitForApplication(db: BillingDb, clock: Clock, input: ReservationInput) {
  const existing = entryOf(db, input.idempotencyKey);

  if (existing !== undefined) {
    return { committed: true as const, row: existing };
  }

  const reservation = openReservationOf(db, input.userId, input.applicationId);

  if (reservation === null) {
    return { committed: false as const };
  }

  const row = postLedgerEntry(db, clock.now(), {
    userId: input.userId,
    kind: "commit",
    amount: reservation.amount,
    grantId: reservation.grantId,
    applicationId: reservation.applicationId,
    idempotencyKey: input.idempotencyKey,
  });

  return { committed: true as const, row };
}

export function releaseForApplication(db: BillingDb, clock: Clock, input: ReservationInput) {
  const existing = entryOf(db, input.idempotencyKey);

  if (existing !== undefined) {
    return { released: true as const, row: existing };
  }

  const reservation = openReservationOf(db, input.userId, input.applicationId);

  if (reservation === null) {
    return { released: false as const };
  }

  const row = postLedgerEntry(db, clock.now(), {
    userId: input.userId,
    kind: "release",
    amount: reservation.amount,
    grantId: reservation.grantId,
    applicationId: reservation.applicationId,
    idempotencyKey: input.idempotencyKey,
  });

  return { released: true as const, row };
}

/**
 * Stops the unused Applications on a refunded grant, so the refunded period
 * can no longer spend them. Callers record the refund itself in the audit log.
 * @param db The database, inside the caller's transaction.
 * @param clock The clock the ledger row is dated with.
 * @param input The user, the grant and the idempotency key of the refund row.
 * @returns The ledger row, or null when the grant had no unused Applications left.
 */
export function refundGrantApplications(
  db: BillingDb,
  clock: Clock,
  input: { userId: string; grantId: string; idempotencyKey: string },
) {
  const available = balancesPerGrant(db, input.userId).get(input.grantId)?.available ?? 0;

  if (available <= 0) {
    return null;
  }

  return postLedgerEntry(db, clock.now(), {
    userId: input.userId,
    kind: "refund",
    amount: available,
    grantId: input.grantId,
    applicationId: null,
    idempotencyKey: input.idempotencyKey,
  });
}

/**
 * Expires a user's due grants. A send already in flight keeps its reservation
 * across the period end, so a confirmed send still commits (charged for what
 * was sent) and a failed one releases then expires on the next sweep
 * (ADR 0008, user story 14).
 * @param db The database to expire grants in.
 * @param clock The clock that decides what has ended.
 * @param userId The user whose grants are due.
 * @returns The grant ids the pass expired.
 */
export function expireDueGrants(db: BillingDb, clock: Clock, userId: string) {
  const at = clock.now();

  const due = db
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.userId, userId),
        sql`${grants.expiresAt} is not null`,
        lte(grants.expiresAt, at),
      ),
    )
    .orderBy(asc(grants.expiresAt), asc(grants.id))
    .all();

  const expired: string[] = [];
  const before = balancesPerGrant(db, userId);

  for (const grant of due) {
    const per = before.get(grant.id);

    if ((per?.available ?? 0) <= 0 && (per?.reserved ?? 0) <= 0) {
      continue;
    }

    db.transaction(
      (tx) => {
        const current = balancesPerGrant(tx, userId);
        const availableBefore = current.get(grant.id)?.available ?? 0;

        if (availableBefore <= 0 && (current.get(grant.id)?.reserved ?? 0) <= 0) {
          return;
        }

        const open = reservationPairsOf(tx, userId).filter(
          (pair) =>
            pair.closedBy === null &&
            pair.reserve.grantId === grant.id &&
            !applicationInFlight(tx, pair.reserve.applicationId),
        );

        for (const pair of open) {
          postLedgerEntry(tx, at, {
            userId,
            kind: "release",
            amount: pair.reserve.amount,
            grantId: pair.reserve.grantId,
            applicationId: pair.reserve.applicationId,
            idempotencyKey: `expire-release:${pair.reserve.id}`,
          });
        }

        const availableAfter = balancesPerGrant(tx, userId).get(grant.id)?.available ?? 0;

        if (availableAfter > 0) {
          postLedgerEntry(tx, at, {
            userId,
            kind: "expire",
            amount: availableAfter,
            grantId: grant.id,
            applicationId: null,
            idempotencyKey: nextExpireKey(tx, grant.id),
          });
        }
      },
      { behavior: "immediate" },
    );

    expired.push(grant.id);
  }

  return expired;
}

export function dailyUsageSince(db: BillingDb, userId: string, sinceMs: number) {
  let usage = 0;

  for (const pair of reservationPairsOf(db, userId)) {
    if (pair.reserve.createdAt < sinceMs) {
      continue;
    }

    if (pair.closedBy === null || pair.closedBy.kind === "commit") {
      usage += 1;
    }
  }

  return usage;
}

export function committedSince(db: BillingDb, userId: string, sinceMs: number) {
  return db
    .select()
    .from(ledger)
    .where(
      and(eq(ledger.userId, userId), eq(ledger.kind, "commit"), gte(ledger.createdAt, sinceMs)),
    )
    .all()
    .reduce((sum, row) => sum + row.amount, 0);
}
