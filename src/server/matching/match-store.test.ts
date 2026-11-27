import { describe, expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { jobs, matches, users } from "../platform/db/schema.ts";
import { createClock } from "../platform/ports/clock.ts";
import {
  dropMatchesNotIn,
  matchIsReusable,
  readStoredMatches,
  replyOf,
  writePendingMatch,
  writeScoredMatch,
} from "./match-store.ts";
import type { ScoreIdentity } from "./match-store.ts";
import type { ScoreReply } from "./score-schema.ts";

const NOW = 1_800_000_000_000;

function fresh() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");
  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "person@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Person",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  return { db, sqlite };
}

const identity: ScoreIdentity = {
  descriptionHash: "hash-1",
  resumeId: null,
  scorerVersion: "score-v1",
  targetsVersion: 3,
};

const reply: ScoreReply = {
  blockers: [],
  level: 20,
  logistics: 10,
  reasons: ["Same Go backend work as your last role.", "The posting asks for five years."],
  role_fit: 40,
  skills: 30,
};

describe("the stored match", () => {
  test("keeps a pending job unscored instead of inventing a number", () => {
    const { db } = fresh();

    writePendingMatch(db, {
      codeRank: 94.6,
      companyKey: "acme",
      descriptionHash: "hash-1",
      exactRole: true,
      jobId: "job-1",
      postedAt: NOW,
      userId: "user-1",
    });

    const [row] = readStoredMatches(db, "user-1");

    expect(row?.score).toBeNull();
    expect(row?.blockers).toEqual([]);
  });

  test("stores the anchored score once and reuses it while the identity holds", () => {
    const { db } = fresh();
    const clock = createClock();

    writeScoredMatch(db, clock, {
      codeRank: 1,
      companyKey: "acme",
      exactRole: true,
      identity,
      jobId: "job-1",
      postedAt: NOW,
      reply,
      userId: "user-1",
    });

    const [row] = readStoredMatches(db, "user-1");

    expect(row?.score).toBe(100);
    expect(row?.roleFit).toBe(40);
    expect(row?.reasons).toHaveLength(2);
    expect(row === undefined ? null : replyOf(row)).toEqual(reply);
    expect(row === undefined ? false : matchIsReusable(row, identity)).toBe(true);
    expect(
      row === undefined ? true : matchIsReusable(row, { ...identity, descriptionHash: "hash-2" }),
    ).toBe(false);
    expect(
      row === undefined ? true : matchIsReusable(row, { ...identity, targetsVersion: 4 }),
    ).toBe(false);
    expect(
      row === undefined ? true : matchIsReusable(row, { ...identity, scorerVersion: "score-v2" }),
    ).toBe(false);
  });

  test("a rescore replaces the same row instead of adding a second one", () => {
    const { db } = fresh();
    const clock = createClock();

    for (const score of [0, 1]) {
      writeScoredMatch(db, clock, {
        codeRank: 1,
        companyKey: "acme",
        exactRole: true,
        identity,
        jobId: "job-1",
        postedAt: NOW,
        reply: { ...reply, skills: score === 0 ? 30 : 20 },
        userId: "user-1",
      });
    }

    const rows = db.select().from(matches).all();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.skills).toBe(20);
  });

  test("drops only the jobs a filter change removed", () => {
    const { db } = fresh();
    const clock = createClock();

    for (const jobId of ["keep", "drop"]) {
      db.insert(jobs)
        .values({
          applyUrl: `https://acme.example/${jobId}`,
          applyVia: "direct",
          atsJobId: jobId,
          boardToken: "acme",
          company: "Acme",
          companyNorm: "acme",
          createdAt: NOW,
          dedupeKey: jobId,
          externalId: `acme:${jobId}`,
          firstSeenAt: NOW,
          freehireSource: "greenhouse",
          id: jobId,
          lastSeenAt: NOW,
          source: "greenhouse",
          title: "Backend Engineer",
          titleNorm: "backend engineer",
          updatedAt: NOW,
        })
        .run();
      writeScoredMatch(db, clock, {
        codeRank: 1,
        companyKey: "acme",
        exactRole: true,
        identity,
        jobId,
        postedAt: NOW,
        reply,
        userId: "user-1",
      });
    }

    expect(dropMatchesNotIn(db, "user-1", ["keep"])).toBe(1);
    expect(readStoredMatches(db, "user-1").map((row) => row.id)).toEqual(["keep"]);
  });
});
