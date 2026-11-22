import { describe, expect, test } from "bun:test";

import type { AppDatabase } from "../platform/db/client.ts";
import {
  applicationEvents,
  applications,
  companies,
  companyBoards,
  postings,
  users,
} from "../platform/db/schema.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import { latestEmailNotesOf } from "./email-notes.ts";

const NOW = 1_795_000_000_000;
const USER = "notes-user";

function seeded(applicationCount: number) {
  const { counter, db } = openCountingDatabase();

  const at = new Date(NOW);

  db.insert(users)
    .values({
      id: USER,
      name: "Notes Owner",
      email: "notes@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: at,
      updatedAt: at,
    })
    .run();

  db.insert(companies)
    .values({ id: "co-1", name: "Northwind", nameNorm: "northwind", createdAt: NOW })
    .run();

  db.insert(companyBoards)
    .values({
      id: "board-1",
      companyId: "co-1",
      ats: "greenhouse",
      boardToken: "board-1",
      region: "us",
      source: "v1_seed",
      lastPolledAt: NOW,
      createdAt: NOW,
    })
    .run();

  for (let index = 0; index < applicationCount; index += 1) {
    addApplication(db, index);
  }

  return { counter, db };
}

function addApplication(db: AppDatabase, index: number) {
  db.insert(postings)
    .values({
      id: `posting-${String(index)}`,
      boardId: "board-1",
      companyId: "co-1",
      ats: "greenhouse",
      atsJobId: `job-${String(index)}`,
      url: `https://example.test/job-${String(index)}`,
      applyUrlNorm: `https://example.test/job-${String(index)}`,
      title: `Engineer ${String(index)}`,
      titleNorm: `engineer ${String(index)}`,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      dedupeKey: `job-${String(index)}`,
    })
    .run();

  db.insert(applications)
    .values({
      id: `app-${String(index)}`,
      userId: USER,
      postingId: `posting-${String(index)}`,
      companyId: "co-1",
      origin: "auto",
      status: "sent",
      stage: "applied",
      sentAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function addEmailEvent(
  db: AppDatabase,
  input: { applicationId: string; at: number; note: string },
) {
  db.insert(applicationEvents)
    .values({
      id: `event-${input.applicationId}-${String(input.at)}`,
      userId: USER,
      applicationId: input.applicationId,
      at: input.at,
      kind: "email",
      source: "email",
      fromValue: null,
      toValue: input.note,
      detail: null,
    })
    .run();
}

describe("the latest email notes", () => {
  test("returns one note per requested Application in a single read", () => {
    const { counter, db } = seeded(40);

    for (let index = 0; index < 40; index += 1) {
      addEmailEvent(db, { applicationId: `app-${String(index)}`, at: NOW, note: "Reply received" });
      addEmailEvent(db, {
        applicationId: `app-${String(index)}`,
        at: NOW + 1000,
        note: "Interviewing",
      });
    }

    counter.reset();

    const notes = latestEmailNotesOf(
      db,
      USER,
      Array.from({ length: 4 }, (_unused, index) => `app-${String(index)}`),
    );

    expect(counter.count()).toBe(1);
    expect([...notes.entries()].toSorted((left, right) => left[0].localeCompare(right[0]))).toEqual(
      [
        ["app-0", "Interviewing"],
        ["app-1", "Interviewing"],
        ["app-2", "Interviewing"],
        ["app-3", "Interviewing"],
      ],
    );
  });

  test("leaves out an Application that was not asked for, and one with no email", () => {
    const { db } = seeded(3);

    addEmailEvent(db, { applicationId: "app-0", at: NOW, note: "Reply received" });

    const notes = latestEmailNotesOf(db, USER, ["app-0", "app-1"]);

    expect(notes.get("app-0")).toBe("Reply received");
    expect(notes.has("app-1")).toBe(false);
    expect(notes.has("app-2")).toBe(false);
  });

  test("reads nothing when no Application is on the board", () => {
    const { counter, db } = seeded(1);

    counter.reset();

    expect(latestEmailNotesOf(db, USER, []).size).toBe(0);
    expect(counter.count()).toBe(0);
  });
});
