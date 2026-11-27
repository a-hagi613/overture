import { describe, expect, test } from "bun:test";
import { asc } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { applicationEvents, applications, checkins, users } from "../platform/db/schema.ts";
import { calendarItemsOf, sortCalendarItems } from "../calendar/items.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import { answerCheckin, runCheckinSweep } from "./checkins.ts";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const DAY = 24 * 60 * 60_000;
const USER_ID = "user-checkins";
const APPLICATION_ID = "application-checkins";
const CHECKIN_ID = "checkin-checkins";

function millisecondPerReadClock(start = NOW) {
  let current = start;
  let reads = 0;

  return {
    now: () => {
      reads += 1;
      const value = current;
      current += 1;

      return value;
    },
    reads: () => reads,
  };
}

function seeded(input: { dueAt?: number; sentAt?: number; stage?: "applied" | "closed" } = {}) {
  const { db } = openCountingDatabase();
  const at = new Date(NOW);

  db.insert(users)
    .values({
      createdAt: at,
      email: "checkins@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Check-ins Person",
      role: "user",
      updatedAt: at,
    })
    .run();

  db.insert(applications)
    .values({
      closedReason: null,
      companyId: "company-checkins",
      companyName: "Ferro Cloud",
      companyNameNorm: "ferro cloud",
      createdAt: NOW,
      id: APPLICATION_ID,
      origin: "pick",
      postingId: "posting-checkins",
      postingTitle: "Senior Platform Engineer",
      postingUrl: "https://boards.example/jobs/checkins",
      sentAt: input.sentAt ?? NOW - 22 * DAY,
      stage: input.stage ?? "applied",
      status: "sent",
      updatedAt: NOW,
      userId: USER_ID,
    })
    .run();

  if ((input.stage ?? "applied") === "applied") {
    db.insert(checkins)
      .values({
        answer: null,
        applicationId: APPLICATION_ID,
        createdAt: NOW,
        dueAt: input.dueAt ?? NOW - DAY,
        id: CHECKIN_ID,
        status: "open",
        userId: USER_ID,
      })
      .run();
  }

  return db;
}

function eventsOf(db: AppDatabase) {
  return db
    .select()
    .from(applicationEvents)
    .orderBy(asc(applicationEvents.at), asc(applicationEvents.id))
    .all();
}

describe("a Check-in answer", () => {
  test("stamps both events with the one moment the answer was recorded", () => {
    const db = seeded();
    const clock = millisecondPerReadClock();

    const result = answerCheckin(
      { clock, db },
      { answer: "rejected", checkinId: CHECKIN_ID, userId: USER_ID },
    );

    expect(result).toEqual({ answer: "rejected", stage: "closed" });

    const events = eventsOf(db);

    expect(events.map((event) => `${event.kind}:${event.source}`).toSorted()).toEqual([
      "checkin:user",
      "stage:checkin",
    ]);
    expect(new Set(events.map((event) => event.at)).size).toBe(1);
  });

  test("keeps the answered Check-in ahead of the Stage move it caused on the Calendar", () => {
    const db = seeded();
    const clock = millisecondPerReadClock();

    answerCheckin({ clock, db }, { answer: "rejected", checkinId: CHECKIN_ID, userId: USER_ID });

    const items = sortCalendarItems(calendarItemsOf(db, USER_ID, NOW, NOW + DAY));

    expect(items.map((item) => item.kind)).toEqual(["checkin", "stage"]);
  });
});

describe("the Check-in sweep closing a no-response Application", () => {
  test("stamps the Stage move and the Check-in with the one moment the pass closed it", () => {
    const db = seeded({ dueAt: NOW - 46 * DAY + 21 * DAY, sentAt: NOW - 46 * DAY });
    const clock = millisecondPerReadClock();

    const result = runCheckinSweep({ clock, db });

    expect(result.closed).toEqual([APPLICATION_ID]);

    const events = eventsOf(db);

    expect(events.map((event) => `${event.kind}:${event.source}`).toSorted()).toEqual([
      "checkin:checkin",
      "stage:system",
    ]);
    expect(new Set(events.map((event) => event.at)).size).toBe(1);
  });
});
