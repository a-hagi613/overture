import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { applications, profiles, users } from "../platform/db/schema.ts";
import { grantApplications } from "../billing/ledger.ts";
import { startOnboarding } from "../profile/onboarding-start.ts";
import { planSendSlots } from "./planning.ts";
import { createPlanner } from "./planner.ts";

const AT = Date.UTC(2026, 2, 10, 7, 0, 0);
const MINUTE_MS = 60_000;
const clock = { now: () => AT };

function freshDatabase() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function addUser(db: AppDatabase, userId: string, running = true) {
  db.insert(users)
    .values({
      createdAt: new Date(AT),
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: userId,
      role: "user",
      updatedAt: new Date(AT),
    })
    .run();

  db.insert(profiles)
    .values({
      createdAt: new Date(AT),
      onboardedAt: new Date(AT),
      pauseReason: null,
      running,
      updatedAt: new Date(AT),
      userId,
    })
    .run();
}

function addApproved(db: AppDatabase, userId: string, id: string, approvedAt = AT) {
  db.insert(applications)
    .values({
      approvedAt,
      companyId: `company-${id}`,
      companyName: `Company ${id}`,
      companyNameNorm: `company-${id}`,
      createdAt: approvedAt,
      id,
      origin: "manual",
      postingId: `posting-${id}`,
      postingTitle: "Engineer",
      postingUrl: "https://example.com/job",
      status: "approved",
      updatedAt: approvedAt,
      userId,
    })
    .run();
}

function grant(db: AppDatabase, userId: string, source: "admin" | "trial", quantity: number) {
  grantApplications(db, clock, {
    idempotencyKey: `grant:${userId}:${source}`,
    quantity,
    source,
    userId,
  });
}

function slotsOf(db: AppDatabase, userId: string) {
  return db
    .select({ scheduledFor: applications.scheduledFor })
    .from(applications)
    .where(eq(applications.userId, userId))
    .all()
    .map((row) => row.scheduledFor);
}

function plannedPlanner(db: AppDatabase) {
  return createPlanner({ clock, db });
}

test("an approved Application with a free slot is eligible at once", () => {
  const { db, sqlite } = freshDatabase();

  try {
    addUser(db, "solo");
    grant(db, "solo", "admin", 5);
    addApproved(db, "solo", "app-1");

    plannedPlanner(db).plan("solo");

    expect(slotsOf(db, "solo")).toEqual([AT]);
  } finally {
    sqlite.close();
  }
});

test("a second paid Application for one person waits five minutes", () => {
  const { db, sqlite } = freshDatabase();

  try {
    addUser(db, "paid");
    grant(db, "paid", "admin", 5);
    addApproved(db, "paid", "app-1", AT);
    addApproved(db, "paid", "app-2", AT + 1);

    plannedPlanner(db).plan("paid");

    expect(slotsOf(db, "paid")).toEqual([AT, AT + 5 * MINUTE_MS]);
  } finally {
    sqlite.close();
  }
});

test("the onboarding trial's three Applications all go at once", () => {
  const { db, sqlite } = freshDatabase();

  try {
    addUser(db, "trial");
    grant(db, "trial", "trial", 3);
    addApproved(db, "trial", "app-1", AT);
    addApproved(db, "trial", "app-2", AT + 1);
    addApproved(db, "trial", "app-3", AT + 2);

    plannedPlanner(db).plan("trial");

    expect(slotsOf(db, "trial")).toEqual([AT, AT, AT]);
  } finally {
    sqlite.close();
  }
});

test("one person's spacing never delays another person's send", () => {
  const { db, sqlite } = freshDatabase();

  try {
    addUser(db, "busy");
    addUser(db, "quiet");
    grant(db, "busy", "admin", 5);
    grant(db, "quiet", "admin", 5);
    addApproved(db, "busy", "busy-1", AT);
    addApproved(db, "busy", "busy-2", AT + 1);
    addApproved(db, "busy", "busy-3", AT + 2);
    addApproved(db, "quiet", "quiet-1", AT + 3);

    plannedPlanner(db).plan("busy");
    plannedPlanner(db).plan("quiet");

    expect(slotsOf(db, "quiet")).toEqual([AT]);
  } finally {
    sqlite.close();
  }
});

test("finishing onboarding switches the account on", () => {
  const { db, sqlite } = freshDatabase();

  try {
    db.insert(users)
      .values({
        createdAt: new Date(AT),
        email: "new@example.com",
        emailVerified: true,
        id: "new",
        name: "New",
        role: "user",
        updatedAt: new Date(AT),
      })
      .run();

    db.insert(profiles)
      .values({
        createdAt: new Date(AT),
        onboardingStep: 3,
        pauseReason: null,
        running: false,
        updatedAt: new Date(AT),
        userId: "new",
      })
      .run();

    expect(startOnboarding(db, clock, "new")).toBe(true);

    expect(
      db
        .select({ pauseReason: profiles.pauseReason, running: profiles.running })
        .from(profiles)
        .where(eq(profiles.userId, "new"))
        .get(),
    ).toEqual({ pauseReason: null, running: true });
  } finally {
    sqlite.close();
  }
});

test("a new approval follows the last scheduled send, even when that send is in the future", () => {
  const scheduled = AT + 10 * MINUTE_MS;

  expect(
    planSendSlots({
      count: 1,
      dailyCap: 10,
      now: AT,
      scheduled: [scheduled],
      spacingMs: 5 * MINUTE_MS,
      timeZone: "UTC",
      usedToday: 0,
    }),
  ).toEqual([scheduled + 5 * MINUTE_MS]);
});

test("a daily cap that is used up moves the next Application to local midnight, not a daytime window", () => {
  const { sqlite } = freshDatabase();

  try {
    expect(
      planSendSlots({
        count: 2,
        dailyCap: 10,
        now: AT,
        scheduled: [],
        spacingMs: 5 * MINUTE_MS,
        timeZone: "UTC",
        usedToday: 9,
      }),
    ).toEqual([AT, Date.UTC(2026, 2, 11, 0, 0, 0)]);
  } finally {
    sqlite.close();
  }
});
