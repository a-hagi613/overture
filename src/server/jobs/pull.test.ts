import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import {
  grants,
  jobPullRuns,
  jobPullState,
  jobs,
  profiles,
  targets,
  users,
} from "../platform/db/schema.ts";
import { createJobStore } from "./store.ts";
import { setSetting } from "../platform/settings/index.ts";
import { createPullService } from "./pull.ts";
import { createFakeJobSource } from "./testing/fake-source.ts";
import type { ApplyTarget } from "./apply-link.ts";

const NOW = 1_800_000_000_000;

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

const record: (overrides?: Partial<FreehireJobRecord>) => FreehireJobRecord = (overrides = {}) => ({
  apply_url: null,
  cities: ["Toronto"],
  closed_at: null,
  company: "Acme",
  company_slug: "acme",
  countries: ["ca"],
  created_at: "2026-11-20T09:00:00Z",
  description: "Build things.",
  enrichment: { category: "backend", seniority: "senior" },
  external_id: "acme:123",
  location: "Toronto, Canada",
  metros: null,
  posted_at: "2026-11-20T00:00:00Z",
  public_slug: "senior-go-engineer-acme",
  reality: { age_days: 2, fake_freshness: true, repost_count: 1 },
  regions: null,
  skills: ["go"],
  source: "greenhouse",
  title: "Senior Go Engineer",
  url: null,
  work_mode: null,
  ...overrides,
});

const target: (job: FreehireJobRecord) => ApplyTarget = (job) => ({
  applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${job.public_slug}`,
  ats: "greenhouse",
  atsJobId: job.public_slug,
  boardToken: "acme",
  via: "direct",
});

function seedUser(
  db: ReturnType<typeof migrated>["db"],
  options: {
    id: string;
    roles?: string[];
    locations?: string[];
    onboarded?: boolean;
  },
) {
  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: `${options.id}@example.test`,
      emailVerified: true,
      id: options.id,
      name: options.id,
      updatedAt: new Date(NOW),
    })
    .run();

  if (options.onboarded !== false) {
    db.insert(profiles)
      .values({
        createdAt: new Date(NOW),
        onboardedAt: new Date(NOW),
        pauseReason: null,
        running: true,
        updatedAt: new Date(NOW),
        userId: options.id,
      })
      .run();
  }

  db.insert(targets)
    .values({
      locations: JSON.stringify(options.locations ?? ["city:ca:toronto"]),
      roles: JSON.stringify(options.roles ?? ["software_engineering"]),
      updatedAt: new Date(NOW),
      userId: options.id,
      version: 1,
    })
    .run();
}

describe("the shared job store", () => {
  test("stores freehire fields directly, null when blank, and dedupes across users", () => {
    const { db } = migrated();
    const store = createJobStore({ clock: { now: () => NOW }, db });
    const first = record();

    expect(store.upsert(first, target(first))).toEqual({
      jobId: first.public_slug,
      status: "kept",
    });

    const row = db.select().from(jobs).where(eq(jobs.id, first.public_slug)).get();

    expect(row?.workMode).toBeNull();
    expect(row?.category).toBe("backend");
    expect(row?.seniority).toBe("senior");
    expect(row?.countries).toBe('["ca"]');
    expect(row?.fakeFreshness).toBe(true);
    expect(row?.status).toBe("open");

    const copy = record({ public_slug: "senior-go-engineer-acme-copy", source: "lever" });

    expect(store.upsert(copy, target(copy))).toEqual({ status: "duplicate" });
    expect(db.select().from(jobs).all()).toHaveLength(1);

    expect(store.close(first.public_slug, NOW + 1000)).toBe(true);
    expect(db.select().from(jobs).where(eq(jobs.id, first.public_slug)).get()?.status).toBe(
      "closed",
    );
  });
});

describe("a pull's counters and page walk", () => {
  test("counts what it kept and dropped for each reason, and stops at a short page", async () => {
    const { db } = migrated();

    seedUser(db, { id: "user-1" });

    const page = {
      ignoredParams: [],
      jobs: [
        record({ public_slug: "kept-one" }),
        record({ closed_at: "2026-11-21T00:00:00Z", public_slug: "closed-one" }),
        record({ public_slug: "unsupported-one", source: "linkedin" }),
        record({ public_slug: "duplicate-one" }),
      ],
      total: 4,
    };

    const source = createFakeJobSource({ pages: [page] });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => NOW },
      db,
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    await service.runUser("user-1");

    const [run] = db.select().from(jobPullRuns).all();

    expect(run?.fetched).toBe(4);
    expect(run?.kept).toBe(1);
    expect(run?.droppedClosed).toBe(1);
    expect(run?.droppedUnsupported).toBe(1);
    expect(run?.droppedDuplicate).toBe(1);
    expect(source.searches).toHaveLength(1);
  });

  test("a job with no apply target is dropped and never stored", async () => {
    const { db } = migrated();

    seedUser(db, { id: "user-1" });

    const source = createFakeJobSource({
      pages: [{ ignoredParams: [], jobs: [record()], total: 1 }],
    });

    const service = createPullService({
      applyTarget: async () => await Promise.resolve(null),
      clock: { now: () => NOW },
      db,
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    await service.runUser("user-1");

    expect(db.select().from(jobs).all()).toHaveLength(0);
    expect(db.select().from(jobPullRuns).all()[0]?.droppedNoLink).toBe(1);
  });
});

describe("pull scheduling", () => {
  test("groups users who share roles and places so one freehire request serves both", async () => {
    const { db } = migrated();

    seedUser(db, { id: "user-1" });
    seedUser(db, { id: "user-2" });
    seedUser(db, { id: "user-3", roles: ["education"] });

    const source = createFakeJobSource({
      pages: [{ ignoredParams: [], jobs: [], total: 0 }],
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => NOW },
      db,
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    await service.runTick(NOW);

    expect(source.searches).toHaveLength(2);
    expect(db.select().from(jobPullState).all()).toHaveLength(3);
  });

  test("a free-trial user gets the onboarding pull and no repeat; a paid user gets the 3-hour pull", async () => {
    const { db } = migrated();
    let now = NOW;

    seedUser(db, { id: "trial-user" });
    seedUser(db, { id: "paid-user" });
    db.insert(grants)
      .values({
        createdAt: NOW,
        expiresAt: NOW + 30 * 86_400_000,
        id: "grant-1",
        quantity: 50,
        source: "period",
        startsAt: NOW,
        userId: "paid-user",
      })
      .run();

    const source = createFakeJobSource({
      pages: [{ ignoredParams: [], jobs: [], total: 0 }],
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => now },
      db,
      source,
      store: createJobStore({ clock: { now: () => now }, db }),
    });

    await service.runTick(NOW);

    expect(source.searches).toHaveLength(1);
    expect(source.searches[0]?.offset).toBe(0);

    now = NOW + 60 * 60_000;
    await service.runTick(now);

    expect(source.searches).toHaveLength(1);

    now = NOW + 3 * 60 * 60_000 + 1;
    await service.runTick(now);

    expect(source.searches).toHaveLength(2);

    const trial = db.select().from(jobPullState).where(eq(jobPullState.userId, "trial-user")).get();
    const paid = db.select().from(jobPullState).where(eq(jobPullState.userId, "paid-user")).get();

    expect(trial?.lastFullPullAt).toBe(NOW);
    expect(paid?.lastFreshPullAt).toBe(now);
  });

  test("a preference change makes the next tick a full pull again", async () => {
    const { db } = migrated();
    let now = NOW;

    seedUser(db, { id: "trial-user", roles: ["software-it"] });

    const source = createFakeJobSource({
      pages: [{ ignoredParams: [], jobs: [], total: 0 }],
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => now },
      db,
      source,
      store: createJobStore({ clock: { now: () => now }, db }),
    });

    await service.runTick(NOW);

    expect(source.searches).toHaveLength(1);

    now = NOW + 60_000;
    db.update(targets)
      .set({ roles: JSON.stringify(["education"]), version: 2, updatedAt: new Date(now) })
      .where(eq(targets.userId, "trial-user"))
      .run();

    await service.runTick(now);

    expect(source.searches).toHaveLength(2);
  });
});

describe("the test-routes switch", () => {
  test("turns every pull off so no automated test can reach freehire", async () => {
    const { db } = migrated();

    seedUser(db, { id: "user-1" });
    setSetting(db, { now: () => NOW }, "jobs.pull_enabled", "false", "system:test");

    const source = createFakeJobSource({
      pages: [{ ignoredParams: [], jobs: [record()], total: 1 }],
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => NOW },
      db,
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    expect(await service.runTick(NOW)).toBe(0);
    expect(await service.runUser("user-1")).toBeNull();
    expect(await service.runChanges()).toBe(0);
    expect(source.searches).toHaveLength(0);
  });
});

describe("resilience", () => {
  test("a failed pull keeps the last good jobs, records the failure and alerts after three in a row", async () => {
    const { db } = migrated();
    const alerts: Record<string, string | number | boolean | null>[] = [];

    seedUser(db, { id: "user-1" });

    const store = createJobStore({ clock: { now: () => NOW }, db });
    const good = record();

    store.upsert(good, target(good));

    const source = createFakeJobSource({
      search: async () => await Promise.reject(new Error("freehire is down")),
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => NOW },
      db,
      onAlert: (detail) => {
        alerts.push(detail);
      },
      source,
      store,
    });

    await service.runTick(NOW);
    await service.runTick(NOW);
    await service.runTick(NOW);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.failures).toBe(3);
    expect(db.select().from(jobs).where(eq(jobs.id, good.public_slug)).get()?.status).toBe("open");
    expect(db.select().from(jobPullState).all()).toHaveLength(0);
  });

  test("with an API key the change feed closes jobs that left the board", async () => {
    const { db } = migrated();
    const store = createJobStore({ clock: { now: () => NOW }, db });
    const job = record();

    store.upsert(job, target(job));

    const source = createFakeJobSource({
      changes: [
        {
          changes: [
            { at: NOW, kind: "closed", publicSlug: job.public_slug, seq: 1 },
            { at: NOW, kind: "opened", publicSlug: "another-job", seq: 2 },
          ],
          hasMore: false,
          nextCursor: "cursor-1",
        },
      ],
    });

    const service = createPullService({
      applyTarget: async (candidate) => await Promise.resolve(target(candidate)),
      clock: { now: () => NOW },
      db,
      hasApiKey: true,
      source,
      store,
    });

    expect(await service.runChanges()).toBe(1);
    expect(db.select().from(jobs).where(eq(jobs.id, job.public_slug)).get()?.status).toBe("closed");
    expect(source.changeCalls).toHaveLength(1);
  });

  test("without a key the change feed is never read", async () => {
    const { db } = migrated();

    const source = createFakeJobSource({
      changes: [{ changes: [], hasMore: false, nextCursor: null }],
    });

    const service = createPullService({
      applyTarget: async (candidate) => await Promise.resolve(target(candidate)),
      clock: { now: () => NOW },
      db,
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    expect(await service.runChanges()).toBe(0);
    expect(source.changeCalls).toHaveLength(0);
  });

  test("without a key the pre-prepare liveness check still closes a vanished job", async () => {
    const { db } = migrated();
    const store = createJobStore({ clock: { now: () => NOW }, db });
    const job = record();

    store.upsert(job, target(job));

    const source = createFakeJobSource({ jobs: {} });

    const service = createPullService({
      applyTarget: async (candidate) => await Promise.resolve(target(candidate)),
      clock: { now: () => NOW },
      db,
      source,
      store,
    });

    expect(await service.jobIsOpen(job.public_slug)).toBe(false);
    expect(db.select().from(jobs).where(eq(jobs.id, job.public_slug)).get()?.status).toBe("closed");
  });
});
