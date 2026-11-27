import { describe, expect, test } from "bun:test";
import type { SQLQueryBindings } from "bun:sqlite";

import { z } from "zod";
import { eq } from "drizzle-orm";

import { migrateDatabase } from "../db/migrate.ts";
import { openDatabase } from "../db/client.ts";
import { bgJobs } from "../db/schema.ts";
import { DEFAULT_MAX_IN_FLIGHT_JOBS } from "./classes.ts";
import {
  claimDueJobsQuery,
  claimJobsToRun,
  enqueueJob,
  recoverBootRunningJobs,
  recoverStaleLocks,
} from "./queue.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);

const clock = { now: () => NOW };

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function enqueueAt(db: ReturnType<typeof migrated>["db"], kind: string, runAt: number) {
  return enqueueJob(db, clock, kind, "{}", { runAt });
}

const queryBinding = z.union([z.string(), z.number(), z.bigint(), z.null()]);

function runningKinds(db: ReturnType<typeof migrated>["db"]) {
  return db
    .select({ kind: bgJobs.kind })
    .from(bgJobs)
    .where(eq(bgJobs.status, "running"))
    .all()
    .map((row) => row.kind);
}

describe("claiming jobs by class", () => {
  test("a stalled browser class does not starve a fast notification job", () => {
    const { db } = migrated();

    for (let index = 0; index < 6; index += 1) {
      enqueueAt(db, "fixtures.capture", NOW - 120_000 + index);
    }

    enqueueAt(db, "push.notify", NOW);

    const claimed = claimJobsToRun(db, clock, {
      batchSize: 2,
      inFlightKinds: ["application.send", "fixtures.capture", "lab.run"],
    });

    expect(claimed.map((job) => job.kind)).toEqual(["push.notify"]);
    expect(runningKinds(db)).toEqual(["push.notify"]);
  });

  test("the total in-flight cap bounds how many jobs a claim starts", () => {
    const { db } = migrated();

    for (let index = 0; index < 8; index += 1) {
      enqueueAt(db, "push.notify", NOW - 8 + index);
    }

    const claimed = claimJobsToRun(db, clock, {
      batchSize: 8,
      inFlightKinds: [
        "fixtures.capture",
        "lab.run",
        "live.check",
        "mail.classify",
        "tag.llm_fallback",
        "billing.notice",
        "push.notify",
        "export.notify",
      ],
    });

    expect(claimed).toHaveLength(DEFAULT_MAX_IN_FLIGHT_JOBS - 8);
  });

  test("a class with room for one starts one and requeues its fellows without an attempt", () => {
    const { db } = migrated();

    for (let index = 0; index < 3; index += 1) {
      enqueueAt(db, "tag.llm_fallback", NOW - 1000 + index);
    }

    enqueueAt(db, "export.notify", NOW);
    enqueueAt(db, "billing.notice", NOW);

    const claimed = claimJobsToRun(db, clock, {
      batchSize: 5,
      inFlightKinds: ["application.prepare", "tag.llm_fallback"],
    });

    expect(
      claimed.map((job) => job.kind).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["billing.notice", "export.notify", "tag.llm_fallback"]);

    const llm = db
      .select({ attempts: bgJobs.attempts, status: bgJobs.status })
      .from(bgJobs)
      .where(eq(bgJobs.kind, "tag.llm_fallback"))
      .all();

    expect(llm.filter((row) => row.status === "queued")).toHaveLength(2);
    expect(llm.map((row) => row.attempts).toSorted((left, right) => left - right)).toEqual([
      0, 0, 1,
    ]);
  });
});

describe("the bg_jobs claim query", () => {
  test("reads the partial claim index and never scans the lifetime history", () => {
    const { db, sqlite } = migrated();

    for (let index = 0; index < 400; index += 1) {
      const { id } = enqueueAt(db, "push.notify", NOW - 86_400_000 - index);

      db.update(bgJobs).set({ status: "done", updatedAt: NOW }).where(eq(bgJobs.id, id)).run();
    }

    enqueueAt(db, "push.notify", NOW);
    enqueueAt(db, "fixtures.capture", NOW);

    sqlite.run("ANALYZE");

    function plan(excludedKinds: readonly string[]) {
      const compiled = claimDueJobsQuery(db, clock, {
        batchSize: 10,
        busyKinds: [],
        excludedKinds,
        singletonKinds: ["catalog.sweep"],
      }).toSQL();

      return sqlite
        .query<{ detail: string }, SQLQueryBindings[]>(`EXPLAIN QUERY PLAN ${compiled.sql}`)
        .all(...z.array(queryBinding).parse(compiled.params))
        .map((row) => row.detail)
        .join("\n");
    }

    for (const excludedKinds of [[], ["fixtures.capture"]]) {
      const queryPlan = plan(excludedKinds);

      expect(queryPlan).toContain("bg_jobs_claim_due");
      expect(queryPlan).not.toMatch(/SCAN bg_jobs\b/u);
    }
  });
});

describe("recovering locks", () => {
  test("boot requeues every running job even inside its lease", () => {
    const { db } = migrated();
    const { id } = enqueueAt(db, "application.send", NOW);

    db.update(bgJobs)
      .set({ attempts: 1, lockedUntil: NOW + 300_000, status: "running" })
      .where(eq(bgJobs.id, id))
      .run();

    expect(recoverBootRunningJobs(db, clock)).toBe(1);

    const row = db.select().from(bgJobs).where(eq(bgJobs.id, id)).get();

    expect(row?.status).toBe("queued");
    expect(row?.lockedUntil).toBeNull();
    expect(row?.attempts).toBe(1);
  });

  test("the periodic sweep skips the ids the worker still holds", () => {
    const { db } = migrated();
    const kept = enqueueAt(db, "fixtures.capture", NOW);
    const stale = enqueueAt(db, "live.check", NOW);

    for (const id of [kept.id, stale.id]) {
      db.update(bgJobs)
        .set({ attempts: 1, lockedUntil: NOW - 1, status: "running" })
        .where(eq(bgJobs.id, id))
        .run();
    }

    expect(recoverStaleLocks(db, clock, [], [kept.id])).toBe(1);
    expect(db.select().from(bgJobs).where(eq(bgJobs.id, kept.id)).get()?.status).toBe("running");
    expect(db.select().from(bgJobs).where(eq(bgJobs.id, stale.id)).get()?.status).toBe("queued");
  });

  test("a sweep only reclaims locks that have expired", () => {
    const { db } = migrated();
    const fresh = enqueueAt(db, "fixtures.capture", NOW);

    db.update(bgJobs)
      .set({ attempts: 1, lockedUntil: NOW + 1, status: "running" })
      .where(eq(bgJobs.id, fresh.id))
      .run();

    expect(recoverStaleLocks(db, clock)).toBe(0);
    expect(db.select().from(bgJobs).where(eq(bgJobs.id, fresh.id)).get()?.status).toBe("running");
  });

  test("a sweep stops at its bound so a stale backlog cannot stall one poll", () => {
    const { db } = migrated();

    for (let index = 0; index < 3; index += 1) {
      const job = enqueueAt(db, "fixtures.capture", NOW);

      db.update(bgJobs)
        .set({ attempts: 1, lockedUntil: NOW - 1, status: "running" })
        .where(eq(bgJobs.id, job.id))
        .run();
    }

    expect(recoverStaleLocks(db, clock, [], [], 2)).toBe(2);
    expect(runningKinds(db).length).toBe(1);
  });
});
