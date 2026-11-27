import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import { createClock } from "../platform/ports/clock.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import {
  applications,
  jobs,
  questions,
  reviewApplications,
  reviews,
  users,
} from "../platform/db/schema.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { listReviews } from "./reviews.ts";

const NOW = 1_795_000_000_000;
const USER = "review-user";
const { db: seedCatalogDb } = openCatalogDatabase(":memory:");

migrateCatalogDatabase(seedCatalogDb, "drizzle-catalog");

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

  seedCatalogDb
    .insert(companies)
    .values({ id: "co-1", name: "Northwind", nameNorm: "northwind", createdAt: NOW })
    .run();

  seedCatalogDb
    .insert(companyBoards)
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
  seedCatalogDb
    .insert(postings)
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
      companyName: "Northwind",
      companyNameNorm: "northwind",
      postingTitle: `Engineer ${String(index)}`,
      postingUrl: `https://example.test/job-${String(index)}`,
      origin: "pick",
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

  seedCatalogDb.delete(companies).run();

  seedUser(db);

  for (let index = 0; index < reviewCount; index += 1) {
    const applicationIds = [
      addApplication(db, index * 3),
      addApplication(db, index * 3 + 1),
      addApplication(db, index * 3 + 2),
    ];

    addReview(db, { applicationIds, index });
  }

  return { catalogDb: seedCatalogDb, counter, db, clock: createClock() };
}

describe("the review list", () => {
  test("keeps one set of statements however many Reviews are open", () => {
    const { catalogDb, counter, db, clock } = seeded(2);

    listReviews({ catalogDb, clock, db, userId: USER });
    counter.reset();

    const two = listReviews({ catalogDb, clock, db, userId: USER });
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

    const eight = listReviews({ catalogDb, clock, db, userId: USER });

    expect(two).toHaveLength(2);
    expect(eight).toHaveLength(8);
    expect(counter.count()).toBe(statementsForTwo);
    expect(statementsForTwo).toBeLessThanOrEqual(5);
  });

  test("lists every open Review once with its company count and attached Applications", () => {
    const { catalogDb, db, clock } = seeded(2);

    const views = listReviews({ catalogDb, clock, db, userId: USER });

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
    const { catalogDb, db, clock } = seeded(2);

    catalogDb.update(postings).set({ closedAt: NOW }).where(eq(postings.id, "posting-0")).run();

    const views = listReviews({ catalogDb, clock, db, userId: USER });

    expect(views.map((view) => [view.id, view.unlocked])).toEqual([
      ["review-1", 3],
      ["review-0", 2],
    ]);

    for (const id of ["posting-1", "posting-2"]) {
      catalogDb.update(postings).set({ closedAt: NOW }).where(eq(postings.id, id)).run();
    }

    expect(listReviews({ catalogDb, clock, db, userId: USER }).map((view) => view.id)).toEqual([
      "review-1",
    ]);
  });

  test("dismisses a Review that has no attached Application, even with no Posting closed", () => {
    const { catalogDb, db, clock } = seeded(2);

    db.delete(reviewApplications).where(eq(reviewApplications.reviewId, "review-0")).run();

    const views = listReviews({ catalogDb, clock, db, userId: USER });

    expect(views.map((view) => view.id)).toEqual(["review-1"]);
  });
});

function addJobApplication(db: AppDatabase, index: number) {
  const postingId = `job-posting-${String(index)}`;

  db.insert(jobs)
    .values({
      applyUrl: "https://jobs.lever.co/northwind/123/apply",
      applyVia: "direct",
      atsJobId: "123",
      boardToken: "northwind",
      company: "Northwind",
      companyNorm: "northwind",
      companySlug: "northwind",
      countries: JSON.stringify(["ca"]),
      createdAt: NOW,
      dedupeKey: `northwind|job ${String(index)}`,
      description: "Build things.",
      externalId: `northwind:${String(index)}`,
      firstSeenAt: NOW,
      freehireSource: "lever",
      id: postingId,
      lastSeenAt: NOW,
      source: "lever",
      title: `Job ${String(index)}`,
      titleNorm: `job ${String(index)}`,
      updatedAt: NOW,
      workMode: "remote",
    })
    .run();

  db.insert(applications)
    .values({
      companyId: "northwind",
      companyName: "Northwind",
      companyNameNorm: "northwind",
      createdAt: NOW,
      id: `job-app-${String(index)}`,
      origin: "pick",
      postingId,
      postingTitle: `Job ${String(index)}`,
      postingUrl: "https://jobs.lever.co/northwind/123",
      status: "preparing",
      updatedAt: NOW,
      userId: USER,
    })
    .run();

  return `job-app-${String(index)}`;
}

describe("the review list after the freehire cutover", () => {
  test("keeps a Review attached while the freehire job is open with an empty catalog", () => {
    const { catalogDb, db, clock } = seeded(1);
    const applicationId = addJobApplication(db, 10);
    const reviewId = addReview(db, { applicationIds: [applicationId], index: 10 });

    expect(listReviews({ catalogDb, clock, db, userId: USER }).map((view) => view.id)).toContain(
      reviewId,
    );

    db.update(jobs).set({ closedAt: NOW, status: "closed" }).run();

    expect(
      listReviews({ catalogDb, clock, db, userId: USER }).map((view) => view.id),
    ).not.toContain(reviewId);
  });
});
