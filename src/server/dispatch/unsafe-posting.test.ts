import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { applications, applicationEvents, users } from "../platform/db/schema.ts";
import { balancesPerGrant, grantApplications, reserveForApplication } from "../billing/ledger.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { skipUnsendableApplication } from "./unsafe-posting.ts";
import type { SkippedAttemptMark } from "./unsafe-posting.ts";

const NOW = Date.UTC(2026, 10, 27, 9, 0, 0);
const USER_ID = "user-unsafe";
const APPLICATION_ID = "application-unsafe";
const ATTEMPT_ID = "attempt-unsafe";

const clock = { now: () => NOW };

function seeded() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "unsafe@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Unsafe Posting Person",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  db.insert(applications)
    .values({
      companyId: "company-unsafe",
      companyName: "Ferro Cloud",
      companyNameNorm: "ferro cloud",
      createdAt: NOW,
      id: APPLICATION_ID,
      origin: "pick",
      postingId: "posting-unsafe",
      postingTitle: "Senior Platform Engineer",
      postingUrl: "http://169.254.169.254/latest/meta-data/",
      stage: "ready",
      status: "sending",
      updatedAt: NOW,
      userId: USER_ID,
    })
    .run();

  const grant = grantApplications(db, clock, {
    idempotencyKey: "grant:unsafe",
    quantity: 3,
    source: "admin",
    userId: USER_ID,
  });

  const reservation = reserveForApplication(db, clock, {
    applicationId: APPLICATION_ID,
    idempotencyKey: `reserve:${ATTEMPT_ID}`,
    userId: USER_ID,
  });

  if (!reservation.reserved) {
    throw new Error("the test could not reserve the Application's credit");
  }

  return { db, grantId: grant.grantId, sqlite };
}

function applicationRow(db: ReturnType<typeof seeded>["db"]) {
  return db.select().from(applications).where(eq(applications.id, APPLICATION_ID)).get();
}

describe("skipUnsendableApplication", () => {
  test("returns the reserved credit and leaves the board with the reason", () => {
    const { db, grantId, sqlite } = seeded();
    const marks: { attemptId: string; values: SkippedAttemptMark }[] = [];

    const before = balancesPerGrant(db, USER_ID).get(grantId);

    expect(before?.available).toBe(2);
    expect(before?.reserved).toBe(1);

    skipUnsendableApplication(
      { clock, db, markAttempt: (attemptId, values) => marks.push({ attemptId, values }) },
      {
        applicationId: APPLICATION_ID,
        attemptId: ATTEMPT_ID,
        errorCode: "insecure",
        statusReason: "posting_url:insecure",
        userId: USER_ID,
      },
    );

    const after = balancesPerGrant(db, USER_ID).get(grantId);

    expect(after?.available).toBe(3);
    expect(after?.reserved).toBe(0);
    expect(after?.used).toBe(0);

    const application = applicationRow(db);

    expect(application?.status).toBe("skipped");
    expect(application?.stage).toBeNull();
    expect(application?.statusReason).toBe("posting_url:insecure");

    const events = db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, APPLICATION_ID))
      .all();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      fromValue: "sending",
      kind: "status",
      source: "system",
      toValue: "skipped",
      userId: USER_ID,
    });
    expect(JSON.parse(events[0]?.detail ?? "{}")).toMatchObject({
      attemptId: ATTEMPT_ID,
      reason: "posting_url:insecure",
    });

    expect(marks).toHaveLength(1);
    expect(marks[0]?.attemptId).toBe(ATTEMPT_ID);
    expect(marks[0]?.values).toEqual({
      endedAt: NOW,
      errorCode: "insecure",
      outcome: "identity_mismatch",
    });

    sqlite.close();
  });

  test("never charges the person twice when the skip runs again", () => {
    const { db, grantId, sqlite } = seeded();

    const skip = () =>
      skipUnsendableApplication(
        { clock, db, markAttempt: () => undefined },
        {
          applicationId: APPLICATION_ID,
          attemptId: ATTEMPT_ID,
          errorCode: "insecure",
          statusReason: "posting_url:insecure",
          userId: USER_ID,
        },
      );

    skip();
    skip();

    const after = balancesPerGrant(db, USER_ID).get(grantId);

    expect(after?.available).toBe(3);
    expect(after?.reserved).toBe(0);
    expect(after?.used).toBe(0);

    const events = db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, APPLICATION_ID))
      .all();

    expect(events).toHaveLength(1);

    sqlite.close();
  });
});
