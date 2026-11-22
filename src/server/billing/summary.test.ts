import { describe, expect, test } from "bun:test";

import { createClock } from "../platform/ports/clock.ts";
import { users } from "../platform/db/schema.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";

import { billingSummary, grantApplications, postLedgerEntry } from "./ledger.ts";

const DAY_MS = 24 * 60 * 60_000;

function freshLedger() {
  const { counter, db } = openCountingDatabase();

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

  return { clock, counter, db, userId: "user-1" };
}

function seeded() {
  const fixture = freshLedger();
  const at = fixture.clock.now();

  const { grantId } = grantApplications(fixture.db, fixture.clock, {
    expiresAt: at + 30 * DAY_MS,
    idempotencyKey: "grant:invite",
    quantity: 12,
    source: "admin",
    startsAt: at,
    userId: fixture.userId,
  });

  grantApplications(fixture.db, fixture.clock, {
    expiresAt: at + 365 * DAY_MS,
    idempotencyKey: "grant:period",
    quantity: 40,
    source: "period",
    startsAt: at,
    userId: fixture.userId,
  });

  return { ...fixture, grantId };
}

describe("the billing summary Home reads", () => {
  test("answers the three counters Home shows in two reads, not six", () => {
    const { clock, counter, db, userId } = seeded();
    const at = clock.now();

    counter.reset();

    const summary = billingSummary(db, userId, at);

    expect(counter.count()).toBe(2);
    expect(summary.applicationsLeft).toBe(52);
    expect(summary.planApplications).toBe(12 + 40);
    expect(summary.endingGrant?.applicationsLeft).toBe(12);
  });

  test("counts a reservation against what is left, exactly as the separate reads do", () => {
    const { clock, db, grantId, userId } = seeded();
    const at = clock.now();

    postLedgerEntry(db, at, {
      amount: 1,
      applicationId: "application-1",
      grantId,
      idempotencyKey: "reserve:application-1",
      kind: "reserve",
      userId,
    });

    expect(billingSummary(db, userId, at).applicationsLeft).toBe(51);
    expect(billingSummary(db, userId, at).planApplications).toBe(52);
  });
});
