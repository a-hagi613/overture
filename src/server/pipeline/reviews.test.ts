import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { openCountingDatabase } from "../testing/query-counter.ts";
import { createClock } from "../platform/ports/clock.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import {
  applications,
  companies,
  companyBoards,
  postings,
  questions,
  reviewApplications,
  reviews,
  users,
} from "../platform/db/schema.ts";
import { listReviews } from "./reviews.ts";

const NOW = 1_795_000_000_000;
const USER = "review-user";

function seedUser(db: AppDatabase) {
  const at = new Date(NOW);

  db.insert(users)
    .values({
      id: USER,
      name: "Review Owner",
      email: "review@example.com",
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
      status: "preparing",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();

  return `app-${String(index)}`;
}

function addReview(db: AppDatabase, input: { applicationIds: readonly string[]; index: number }) {
  const id = `review-${String(input.index)}`;

  db.insert(questions)
    .values({
      id: `q-${String(input.index)}`,
      textDisplay: `Question ${String(input.index)}?`,
      textNormHash: `question-${String(input.index)}`,
      fieldType: "text",
      answerKind: "unknown",
      createdAt: NOW,
    })
    .run();

  db.insert(reviews)
    .values({
      id,
      userId: USER,
      questionId: `q-${String(input.index)}`,
      factKey: null,
      scope: "",
      prompt: `Question ${String(input.index)}?`,
      fieldType: "text",
      options: "[]",
      reason: "unknown_required",
      status: "open",
      createdAt: NOW + input.index,
      resolvedAt: null,
    })
    .run();

  for (const applicationId of input.applicationIds) {
    db.insert(reviewApplications).values({ reviewId: id, applicationId }).run();
  }

  return id;
}

function seeded(reviewCount: number) {
  const { counter, db } = openCountingDatabase();

  seedUser(db);

  for (let index = 0; index < reviewCount; index += 1) {
    const applicationIds = [
      addApplication(db, index * 3),
      addApplication(db, index * 3 + 1),
      addApplication(db, index * 3 + 2),
    ];

    addReview(db, { applicationIds, index });
  }

  return { counter, db, clock: createClock() };
}

describe("the review list", () => {
  test("keeps one set of statements however many Reviews are open", () => {
    const { counter, db, clock } = seeded(2);

    listReviews({ clock, db, userId: USER });
    counter.reset();

    const two = listReviews({ clock, db, userId: USER });
    const statementsForTwo = counter.count();

    for (let index = 2; index < 8; index += 1) {
      const applicationIds = [
        addApplication(db, index * 3),
        addApplication(db, index * 3 + 1),
        addApplication(db, index * 3 + 2),
      ];

      addReview(db, { applicationIds, index });
    }

    counter.reset();

    const eight = listReviews({ clock, db, userId: USER });

    expect(two).toHaveLength(2);
    expect(eight).toHaveLength(8);
    expect(counter.count()).toBe(statementsForTwo);
    expect(statementsForTwo).toBeLessThanOrEqual(5);
  });

  test("lists every open Review once with its company count and attached Applications", () => {
    const { db, clock } = seeded(2);

    const views = listReviews({ clock, db, userId: USER });

    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      companies: 1,
      unlocked: 3,
      prompt: "Question 0?",
    });
    expect(views[0]?.applications.map((application) => application.applicationId)).toEqual([
      "app-0",
      "app-1",
      "app-2",
    ]);
    expect(views[0]?.applications[0]).toMatchObject({
      company: "Northwind",
      title: "Engineer 0",
    });
  });

  test("detaches an Application whose Posting closed, and dismisses a Review left empty", () => {
    const { db, clock } = seeded(2);

    db.update(postings).set({ closedAt: NOW }).where(eq(postings.id, "posting-0")).run();

    const views = listReviews({ clock, db, userId: USER });

    expect(views.map((view) => [view.id, view.unlocked])).toEqual([
      ["review-1", 3],
      ["review-0", 2],
    ]);

    for (const id of ["posting-1", "posting-2"]) {
      db.update(postings).set({ closedAt: NOW }).where(eq(postings.id, id)).run();
    }

    expect(listReviews({ clock, db, userId: USER }).map((view) => view.id)).toEqual(["review-1"]);
  });

  test("dismisses a Review that has no attached Application, even with no Posting closed", () => {
    const { db, clock } = seeded(2);

    db.delete(reviewApplications).where(eq(reviewApplications.reviewId, "review-0")).run();

    const views = listReviews({ clock, db, userId: USER });

    expect(views.map((view) => view.id)).toEqual(["review-1"]);
  });
});
