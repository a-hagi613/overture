import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { applicationEvents, applications, users } from "../platform/db/schema.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import {
  applicationEventDetail,
  parseApplicationEventDetail,
  readApplicationTimeline,
  recordApplicationEvent,
} from "./events.ts";

const NOW = Date.UTC(2026, 10, 25, 9, 0, 0);
const USER_ID = "user-events";
const APPLICATION_ID = "application-events";

const clock = { now: () => NOW };

function fresh() {
  const { db } = openCountingDatabase();

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "events@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Events Person",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  db.insert(applications)
    .values({
      companyId: "company-events",
      companyName: "Ferro Cloud",
      companyNameNorm: "ferro cloud",
      createdAt: NOW,
      id: APPLICATION_ID,
      origin: "auto",
      postingId: "posting-events",
      postingTitle: "Senior Platform Engineer",
      postingUrl: "https://boards.example/jobs/events",
      status: "sending",
      stage: "ready",
      updatedAt: NOW,
      userId: USER_ID,
    })
    .run();

  return db;
}

function notesOf(db: AppDatabase) {
  return db
    .select()
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, APPLICATION_ID))
    .all();
}

describe("the application event writer", () => {
  test("stores the stage, time, reason and attempt id in one structured event", () => {
    const db = fresh();

    recordApplicationEvent(db, clock, {
      applicationId: APPLICATION_ID,
      attemptId: "attempt-1",
      fromValue: "ready",
      kind: "stage",
      reason: "approved_send",
      source: "system",
      toValue: "applying",
      userId: USER_ID,
    });

    const [row] = notesOf(db);

    expect(row).toMatchObject({
      applicationId: APPLICATION_ID,
      at: NOW,
      fromValue: "ready",
      kind: "stage",
      source: "system",
      toValue: "applying",
      userId: USER_ID,
    });
    expect(parseApplicationEventDetail(row?.detail ?? null)).toEqual({
      attemptId: "attempt-1",
      reason: "approved_send",
    });

    expect(readApplicationTimeline(db, APPLICATION_ID)[0]).toMatchObject({
      at: NOW,
      attemptId: "attempt-1",
      fromValue: "ready",
      kind: "stage",
      reason: "approved_send",
      source: "system",
      toValue: "applying",
    });
  });

  test("keeps extra structured detail and leaves the reason null for a plain event", () => {
    const db = fresh();

    recordApplicationEvent(db, clock, {
      applicationId: APPLICATION_ID,
      detail: { waitedFor: "code", waitMinutes: 12 },
      fromValue: "ready",
      kind: "note",
      source: "system",
      toValue: null,
      userId: USER_ID,
    });

    const [entry] = readApplicationTimeline(db, APPLICATION_ID);

    expect(entry).toMatchObject({
      attemptId: null,
      reason: null,
    });
    expect(entry?.detail).toEqual({ waitedFor: "code", waitMinutes: 12 });
  });

  test("keeps an old free-text detail readable rather than losing it", () => {
    expect(parseApplicationEventDetail("not json")).toEqual({ text: "not json" });
    expect(applicationEventDetail({ reason: "", detail: {} })).toBe('{"reason":""}');
  });
});
