import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { setSetting } from "../platform/settings/index.ts";
import { acceptInvite, INVITE_GRANT_QUANTITY_KEY } from "../auth/invites.ts";
import { grants, invites, ledger, users } from "../platform/db/schema.ts";

import {
  applicationsLeft,
  balancesPerGrant,
  commitForApplication,
  committedSince,
  dailyUsageSince,
  endingGrantOf,
  expireDueGrants,
  grantApplications,
  ledgerBalances,
  planApplications,
  releaseForApplication,
  reserveForApplication,
} from "./ledger.ts";
import { grantPaidPeriod } from "./periods.ts";
import { periodEndFor, planForPriceId } from "./plans.ts";

const DAY_MS = 24 * 60 * 60_000;

function freshLedger() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const at = clock.now();

  db.insert(users)
    .values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: new Date(at),
      updatedAt: new Date(at),
    })
    .run();

  return { clock, db, sqlite, userId: "user-1" };
}

describe("the ledger", () => {
  test("names the invite grant that is running out, with its Applications left and end date", () => {
    const { clock, db, userId } = freshLedger();
    const at = clock.now();

    expect(endingGrantOf(db, userId, at)).toBeNull();

    grantApplications(db, clock, {
      expiresAt: at + 37 * DAY_MS,
      startsAt: at,
      idempotencyKey: "grant:invite",
      quantity: 12,
      source: "admin",
      userId,
    });

    expect(endingGrantOf(db, userId, at)).toStrictEqual({
      applicationsLeft: 12,
      expiresAt: at + 37 * DAY_MS,
    });

    grantApplications(db, clock, {
      idempotencyKey: "grant:open",
      startsAt: at,
      quantity: 4,
      source: "admin",
      userId,
    });

    expect(endingGrantOf(db, userId, at)?.applicationsLeft).toBe(12);
    expect(endingGrantOf(db, userId, at + 40 * DAY_MS)).toBeNull();
  });

  test("equals itself across every transfer", () => {
    const { clock, db, sqlite, userId } = freshLedger();

    grantApplications(db, clock, {
      idempotencyKey: "grant:1",
      quantity: 5,
      source: "admin",
      userId,
    });
    grantApplications(db, clock, {
      idempotencyKey: "grant:2",
      quantity: 3,
      source: "admin",
      userId,
    });

    expect(ledgerBalances(db, userId)).toStrictEqual({
      available: 8,
      expired: 0,
      issued: -8,
      reserved: 0,
      used: 0,
    });
    expect(planApplications(db, userId, clock.now())).toBe(8);
    expect(applicationsLeft(db, userId, clock.now())).toBe(8);

    const reserved = reserveForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "reserve:app-1:1",
      userId,
    });

    expect(reserved.reserved).toBe(true);
    expect(applicationsLeft(db, userId, clock.now())).toBe(7);
    expect(ledgerBalances(db, userId).reserved).toBe(1);

    const committed = commitForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "commit:app-1",
      userId,
    });

    expect(committed.committed).toBe(true);
    expect(ledgerBalances(db, userId)).toStrictEqual({
      available: 7,
      expired: 0,
      issued: -8,
      reserved: 0,
      used: 1,
    });

    reserveForApplication(db, clock, {
      applicationId: "app-2",
      idempotencyKey: "reserve:app-2:1",
      userId,
    });

    const released = releaseForApplication(db, clock, {
      applicationId: "app-2",
      idempotencyKey: "release:app-2",
      userId,
    });

    expect(released.released).toBe(true);
    expect(applicationsLeft(db, userId, clock.now())).toBe(7);

    sqlite.close();
  });

  test("never writes twice for the same idempotency key", () => {
    const { clock, db, sqlite, userId } = freshLedger();

    const first = grantApplications(db, clock, {
      idempotencyKey: "grant:1",
      quantity: 5,
      source: "admin",
      userId,
    });

    const second = grantApplications(db, clock, {
      idempotencyKey: "grant:1",
      quantity: 5,
      source: "admin",
      userId,
    });

    expect(second.entry.id).toBe(first.entry.id);
    expect(planApplications(db, userId, clock.now())).toBe(5);

    reserveForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "reserve:app-1:1",
      userId,
    });

    const retried = reserveForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "reserve:app-1:1",
      userId,
    });

    expect(retried.reserved).toBe(true);
    expect(ledgerBalances(db, userId).reserved).toBe(1);

    commitForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "commit:app-1",
      userId,
    });

    const recommitted = commitForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "commit:app-1",
      userId,
    });

    expect(recommitted.committed).toBe(true);
    expect(ledgerBalances(db, userId).used).toBe(1);
    expect(applicationsLeft(db, userId, clock.now())).toBe(4);

    const releasedTw = releaseForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "release:app-1",
      userId,
    });

    expect(releasedTw.released).toBe(false);
    sqlite.close();
  });

  test("reserves from the grant expiring soonest", () => {
    const { clock, db, sqlite, userId } = freshLedger();
    const at = clock.now();

    const soonest = grantApplications(db, clock, {
      expiresAt: at + 10_000,
      idempotencyKey: "grant:soonest",
      quantity: 3,
      source: "admin",
      userId,
    });

    const latest = grantApplications(db, clock, {
      expiresAt: at + 100_000,
      idempotencyKey: "grant:latest",
      quantity: 2,
      source: "admin",
      userId,
    });

    const reserved = reserveForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "reserve:app-1:1",
      userId,
    });

    expect(reserved.reserved).toBe(true);
    expect(reserved.reserved && reserved.grantId).toBe(soonest.grantId);
    expect(balancesPerGrant(db, userId).get(latest.grantId)).toStrictEqual({
      available: 2,
      expired: 0,
      issued: -2,
      reserved: 0,
      used: 0,
    });

    sqlite.close();
  });

  test("expires the oldest due grant first and moves only the available balance", () => {
    const { clock, db, sqlite, userId } = freshLedger();
    const at = clock.now();

    const older = grantApplications(db, clock, {
      expiresAt: at + 10_000,
      idempotencyKey: "grant:older",
      quantity: 3,
      source: "admin",
      userId,
    });

    const newer = grantApplications(db, clock, {
      expiresAt: at + 50_000,
      idempotencyKey: "grant:newer",
      quantity: 2,
      source: "admin",
      userId,
    });

    reserveForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "reserve:app-1:1",
      userId,
    });
    commitForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "commit:app-1",
      userId,
    });

    clock.setOffset(60_000);

    const expired = expireDueGrants(db, clock, userId);

    expect(expired).toStrictEqual([older.grantId, newer.grantId]);
    expect(balancesPerGrant(db, userId).get(older.grantId)).toStrictEqual({
      available: 0,
      expired: 2,
      issued: -3,
      reserved: 0,
      used: 1,
    });
    expect(balancesPerGrant(db, userId).get(newer.grantId)).toStrictEqual({
      available: 0,
      expired: 2,
      issued: -2,
      reserved: 0,
      used: 0,
    });
    expect(applicationsLeft(db, userId, clock.now())).toBe(0);
    expect(planApplications(db, userId, clock.now())).toBe(0);

    const reservedAgain = reserveForApplication(db, clock, {
      applicationId: "app-2",
      idempotencyKey: "reserve:app-2:1",
      userId,
    });

    expect(reservedAgain.reserved).toBe(false);
    expect(ledgerBalances(db, userId)).toStrictEqual({
      available: 0,
      expired: 4,
      issued: -5,
      reserved: 0,
      used: 1,
    });

    sqlite.close();
  });

  test("releases a reservation held on an expiring grant and then expires it", () => {
    const { clock, db, sqlite, userId } = freshLedger();
    const at = clock.now();

    const grant = grantApplications(db, clock, {
      expiresAt: at + 10_000,
      idempotencyKey: "grant:1",
      quantity: 5,
      source: "admin",
      userId,
    });

    reserveForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "reserve:app-1:1",
      userId,
    });

    expect(ledgerBalances(db, userId)).toStrictEqual({
      available: 4,
      expired: 0,
      issued: -5,
      reserved: 1,
      used: 0,
    });

    const usageBefore = dailyUsageSince(db, userId, at - 1000);
    const sentBefore = committedSince(db, userId, at - 1000);

    expect(usageBefore).toBe(1);
    expect(sentBefore).toBe(0);

    clock.setOffset(20_000);

    const expired = expireDueGrants(db, clock, userId);

    expect(expired).toStrictEqual([grant.grantId]);
    expect(balancesPerGrant(db, userId).get(grant.grantId)).toStrictEqual({
      available: 0,
      expired: 5,
      issued: -5,
      reserved: 0,
      used: 0,
    });

    const released = releaseForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "release:after-expire",
      userId,
    });

    expect(released.released).toBe(false);
    expect(applicationsLeft(db, userId, clock.now())).toBe(0);
    expect(dailyUsageSince(db, userId, at - 1000)).toBe(0);

    sqlite.close();
  });

  test("counts daily usage against the day each reservation was made", () => {
    const { clock, db, sqlite, userId } = freshLedger();
    const at = clock.now();

    grantApplications(db, clock, {
      idempotencyKey: "grant:1",
      quantity: 10,
      source: "admin",
      userId,
    });

    expect(
      commitForApplication(db, clock, {
        applicationId: "app-1",
        idempotencyKey: "commit:app-1",
        userId,
      }).committed,
    ).toBe(false);

    reserveForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "reserve:app-1:1",
      userId,
    });
    commitForApplication(db, clock, {
      applicationId: "app-1",
      idempotencyKey: "commit:app-1",
      userId,
    });
    reserveForApplication(db, clock, {
      applicationId: "app-2",
      idempotencyKey: "reserve:app-2:1",
      userId,
    });

    expect(committedSince(db, userId, at)).toBe(1);
    expect(dailyUsageSince(db, userId, at)).toBe(2);

    releaseForApplication(db, clock, {
      applicationId: "app-2",
      idempotencyKey: "release:app-2",
      userId,
    });

    expect(dailyUsageSince(db, userId, at)).toBe(1);

    clock.setOffset(2000);

    reserveForApplication(db, clock, {
      applicationId: "app-3",
      idempotencyKey: "reserve:app-3:1",
      userId,
    });
    commitForApplication(db, clock, {
      applicationId: "app-3",
      idempotencyKey: "commit:app-3",
      userId,
    });

    expect(dailyUsageSince(db, userId, at)).toBe(2);
    expect(committedSince(db, userId, at)).toBe(2);
    expect(dailyUsageSince(db, userId, clock.now() + 1)).toBe(0);

    sqlite.close();
  });
});

describe("a period grant", () => {
  test("carries the plan's applications from the paid invoice until its period ends", () => {
    const { clock, db, sqlite, userId } = freshLedger();
    const at = clock.now();
    const periodEnd = at + 7 * DAY_MS;

    const granted = grantPaidPeriod(db, clock, {
      invoiceId: "in_week_1",
      periodEndMs: periodEnd,
      periodStartMs: at,
      plan: "week",
      userId,
    });

    expect(granted.created).toBe(true);
    expect(applicationsLeft(db, userId, at)).toBe(50);
    expect(planApplications(db, userId, at)).toBe(50);

    const row = db.select().from(grants).where(eq(grants.id, granted.grantId)).get();

    expect(row).toMatchObject({
      expiresAt: periodEnd,
      quantity: 50,
      source: "period",
      startsAt: at,
      stripeInvoiceId: "in_week_1",
    });

    const next = grantPaidPeriod(db, clock, {
      invoiceId: "in_week_2",
      periodEndMs: periodEnd + 7 * DAY_MS,
      periodStartMs: periodEnd,
      plan: "week",
      userId,
    });

    const replayed = grantPaidPeriod(db, clock, {
      invoiceId: "in_week_2",
      periodEndMs: periodEnd + 7 * DAY_MS,
      periodStartMs: periodEnd,
      plan: "week",
      userId,
    });

    expect(replayed.created).toBe(false);
    expect(replayed.grantId).toBe(next.grantId);
    expect(db.select().from(grants).where(eq(grants.userId, userId)).all()).toHaveLength(2);
    expect(applicationsLeft(db, userId, at)).toBe(50);
    expect(planApplications(db, userId, at)).toBe(50);

    clock.setOffset(8 * DAY_MS);

    expect(applicationsLeft(db, userId, clock.now())).toBe(50);
    expect(planApplications(db, userId, clock.now())).toBe(50);

    clock.setOffset(15 * DAY_MS);

    expect(applicationsLeft(db, userId, clock.now())).toBe(0);

    sqlite.close();
  });

  test("releases a reservation still held when its period ends, then expires it", () => {
    const { clock, db, sqlite, userId } = freshLedger();
    const at = clock.now();
    const periodEnd = at + 30 * DAY_MS;

    const granted = grantPaidPeriod(db, clock, {
      invoiceId: "in_month_1",
      periodEndMs: periodEnd,
      periodStartMs: at,
      plan: "month",
      userId,
    });

    reserveForApplication(db, clock, {
      applicationId: "app-open",
      idempotencyKey: "reserve:app-open:1",
      userId,
    });

    expect(applicationsLeft(db, userId, at)).toBe(249);
    expect(balancesPerGrant(db, userId).get(granted.grantId)?.reserved).toBe(1);

    clock.setOffset(30 * DAY_MS + 1);

    const expired = expireDueGrants(db, clock, userId);

    expect(expired).toStrictEqual([granted.grantId]);
    expect(balancesPerGrant(db, userId).get(granted.grantId)).toStrictEqual({
      available: 0,
      expired: 250,
      issued: -250,
      reserved: 0,
      used: 0,
    });
    expect(applicationsLeft(db, userId, clock.now())).toBe(0);

    const rows = db.select().from(ledger).where(eq(ledger.userId, userId)).all();
    const reserveRow = rows.find((row) => row.kind === "reserve");
    const releaseRow = rows.find((row) => row.kind === "release");
    const expireRow = rows.find((row) => row.kind === "expire");

    expect(reserveRow).toBeDefined();
    expect(releaseRow?.idempotencyKey).toBe(`expire-release:${reserveRow?.id ?? ""}`);
    expect(releaseRow?.applicationId).toBe("app-open");
    expect(expireRow).toMatchObject({
      amount: 250,
      applicationId: null,
      creditAccount: "expired",
      debitAccount: "available",
    });

    const again = expireDueGrants(db, clock, userId);

    expect(again).toStrictEqual([]);
    expect(db.select().from(ledger).where(eq(ledger.userId, userId)).all()).toHaveLength(
      rows.length,
    );

    sqlite.close();
  });

  test("a renewal grants the next period after the first one expires", () => {
    const { clock, db, sqlite, userId } = freshLedger();
    const at = clock.now();
    const firstEnd = at + 30 * DAY_MS;

    const first = grantPaidPeriod(db, clock, {
      invoiceId: "in_month_1",
      periodEndMs: firstEnd,
      periodStartMs: at,
      plan: "month",
      userId,
    });

    clock.setOffset(30 * DAY_MS + 1);

    expect(expireDueGrants(db, clock, userId)).toStrictEqual([first.grantId]);
    expect(applicationsLeft(db, userId, clock.now())).toBe(0);

    const second = grantPaidPeriod(db, clock, {
      invoiceId: "in_month_2",
      periodEndMs: firstEnd + 30 * DAY_MS,
      periodStartMs: firstEnd,
      plan: "month",
      userId,
    });

    expect(second.created).toBe(true);
    expect(applicationsLeft(db, userId, clock.now())).toBe(250);
    expect(planApplications(db, userId, clock.now())).toBe(250);
    expect(balancesPerGrant(db, userId).get(first.grantId)?.expired).toBe(250);
    expect(balancesPerGrant(db, userId).get(second.grantId)?.available).toBe(250);

    sqlite.close();
  });
});

describe("plan configuration", () => {
  test("maps each configured price to its plan and nothing else", () => {
    const prices = { month: "price_month", week: "price_week" };

    expect(planForPriceId("price_week", prices)).toBe("week");
    expect(planForPriceId("price_month", prices)).toBe("month");
    expect(planForPriceId("price_other", prices)).toBeNull();
    expect(planForPriceId("price_week", { month: "price_month", week: null })).toBeNull();
  });

  test("falls back to the plan's own period when an invoice names no end", () => {
    const at = Date.UTC(2026, 10, 21);

    expect(periodEndFor("week", at)).toBe(at + 7 * DAY_MS);
    expect(periodEndFor("month", at)).toBe(at + 30 * DAY_MS);
  });
});

function acceptInviteWith(quantity: string) {
  const { clock, db, sqlite, userId } = freshLedger();

  setSetting(db, clock, INVITE_GRANT_QUANTITY_KEY, quantity, "test");

  db.insert(invites)
    .values({ createdAt: new Date(clock.now()), emailHash: `hash-${quantity}`, id: "invite-1" })
    .run();

  const invite = db.select().from(invites).where(eq(invites.id, "invite-1")).get();

  if (invite === undefined) {
    throw new Error("the invite fixture was not stored");
  }

  const accepted = acceptInvite(db, clock, invite, userId);
  const grant = db.select().from(grants).where(eq(grants.userId, userId)).get();

  return { accepted, clock, db, grant, sqlite, userId };
}

describe("an invite grant reads its quantity once", () => {
  test("grants the configured quantity", () => {
    const { accepted, clock, db, sqlite, userId } = acceptInviteWith("5");

    expect(accepted).not.toBeNull();
    expect(applicationsLeft(db, userId, clock.now())).toBe(5);

    sqlite.close();
  });

  test("never turns an unusable quantity into a zero-application grant", () => {
    const { clock, db, sqlite, userId } = acceptInviteWith("0");

    expect(applicationsLeft(db, userId, clock.now())).toBe(300);

    sqlite.close();
  });

  test("never truncates a fraction below one into a zero-application grant", () => {
    const { clock, db, sqlite, userId } = acceptInviteWith("0.5");

    expect(applicationsLeft(db, userId, clock.now())).toBe(300);

    sqlite.close();
  });

  test("truncates a fractional quantity to whole applications", () => {
    const { clock, db, sqlite, userId } = acceptInviteWith("2.5");

    expect(applicationsLeft(db, userId, clock.now())).toBe(2);

    sqlite.close();
  });
});
