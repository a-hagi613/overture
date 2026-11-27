import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { jobs, matches, users } from "../platform/db/schema.ts";

import { onboardingMatchesOf } from "./freehire-matches.ts";

const NOW = 1_795_735_200_000;

function seed() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "user@example.com",
      emailVerified: true,
      id: "user-1",
      name: "User",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  const titles = ["Backend Engineer", "Data Engineer", "DevOps Engineer"];

  for (const [index, title] of titles.entries()) {
    const id = `job-${String(index)}`;

    db.insert(jobs)
      .values({
        applyUrl: `https://acme.example/${String(index)}/apply`,
        applyVia: "direct",
        atsJobId: String(index),
        boardToken: "acme",
        company: "Acme",
        companyNorm: "acme",
        countries: '["ca"]',
        createdAt: NOW,
        dedupeKey: id,
        employmentType: "full_time",
        externalId: `acme:${String(index)}`,
        firstSeenAt: NOW,
        freehireSource: "greenhouse",
        id,
        lastSeenAt: NOW,
        locationRaw: "Toronto, ON",
        salaryCurrency: "CAD",
        salaryMin: 120_000,
        salaryPeriod: "year",
        source: "greenhouse",
        status: "open",
        title,
        titleNorm: title.toLowerCase(),
        updatedAt: NOW,
        url: `https://acme.example/${String(index)}`,
        workMode: "remote",
      })
      .run();
  }

  const scores = [
    { reasons: ["Backend services in Go.", "Remote across Canada."], score: 88 },
    { reasons: ["Data pipelines on your resume."], score: 72 },
  ] as const;

  for (const [index, row] of scores.entries()) {
    db.insert(matches)
      .values({
        blockers: "[]",
        codeRank: 0,
        postingId: `job-${String(index)}`,
        reasons: JSON.stringify(row.reasons),
        score: row.score,
        scoredAt: NOW,
        userId: "user-1",
      })
      .run();
  }

  db.insert(matches)
    .values({
      blockers: "[]",
      codeRank: 0,
      postingId: "job-2",
      reasons: "[]",
      score: null,
      userId: "user-1",
    })
    .run();

  return { db };
}

describe("the onboarding match view over freehire scores", () => {
  test("orders by stored score, hides an unscored row and carries the reasons", () => {
    const { db } = seed();

    const view = onboardingMatchesOf({ db, strongThreshold: 80 }, "user-1", 10);

    expect(view.map((match) => match.id)).toEqual(["job-0", "job-1"]);
    expect(view.map((match) => match.score)).toEqual([88, 72]);
    expect(view[0]?.strong).toBe(true);
    expect(view[1]?.strong).toBe(false);
    expect(view[0]?.why).toEqual(["Backend services in Go.", "Remote across Canada."]);
  });

  test("shows the plan's number of rows and reads the freehire display fields", () => {
    const { db } = seed();

    const view = onboardingMatchesOf({ db, strongThreshold: 80 }, "user-1", 2);

    expect(view).toHaveLength(2);
    expect(view[0]).toMatchObject({
      company: "Acme",
      employmentType: "full_time",
      location: "Toronto, ON",
      salaryCurrency: "CAD",
      salaryMinMinor: 12_000_000,
      salaryPeriod: "year",
      title: "Backend Engineer",
      workplace: "remote",
    });
  });

  test("drops a stored score whose job has left the table rather than inventing one", () => {
    const { db } = seed();

    db.delete(jobs).where(eq(jobs.id, "job-0")).run();

    expect(onboardingMatchesOf({ db, strongThreshold: 80 }, "user-1", 10).map((m) => m.id)).toEqual(
      ["job-1"],
    );
  });
});
