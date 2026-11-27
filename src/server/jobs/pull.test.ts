import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import {
  bgJobs,
  events,
  grants,
  jobPullRuns,
  jobPullState,
  jobs,
  profiles,
  targets,
  users,
} from "../platform/db/schema.ts";
import { createJobStore } from "./store.ts";
import type { JobStore } from "./store.ts";
import { getSetting, setSetting } from "../platform/settings/index.ts";
import { createPullJobHandlers, createPullService } from "./pull.ts";
import type { PullService } from "./pull.ts";
import { createFakeJobSource } from "./testing/fake-source.ts";
import { JobSourceError } from "./source.ts";
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

  test("skips a member whose account is deleted while the pull is in flight", async () => {
    const { db, sqlite } = migrated();

    seedUser(db, { id: "user-1" });
    seedUser(db, { id: "user-2" });

    const fake = createFakeJobSource({
      pages: [{ ignoredParams: [], jobs: [], total: 0 }],
    });

    const source = {
      ...fake,
      search: async (query: Parameters<typeof fake.search>[0]) => {
        sqlite.run("delete from users where id = 'user-2'");

        return await fake.search(query);
      },
    };

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => NOW },
      db,
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    await service.runTick(NOW);

    expect(
      db
        .select()
        .from(jobPullState)
        .all()
        .map((row) => row.userId),
    ).toEqual(["user-1"]);
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
  test("a failed pull keeps the last good jobs, and the third in a row alerts once with the error", async () => {
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
    expect(alerts[0]).toMatchObject({
      error: "freehire is down",
      failures: 3,
      mode: "full",
      userCount: 1,
    });
    expect(getSetting(db, "jobs.pull_last_error")).toBe("freehire is down");
    expect(db.select().from(jobs).where(eq(jobs.id, good.public_slug)).get()?.status).toBe("open");
    expect(db.select().from(jobPullState).all()).toHaveLength(0);

    await service.runTick(NOW);

    expect(alerts).toHaveLength(1);
  });

  test("one posting that throws in the store is skipped and named, and the rest of the group is stored", async () => {
    const { db } = migrated();
    const alerts: Record<string, string | number | boolean | null>[] = [];

    seedUser(db, { id: "user-1" });

    const clock = { now: () => NOW };
    const realStore = createJobStore({ clock, db });

    const poison = record({
      company: "Acme",
      company_slug: "acme",
      external_id: "acme:666",
      public_slug: "poisoned-platform-engineer-acme",
      title: "Platform Engineer",
    });

    const good = record({
      company: "Acme",
      company_slug: "acme",
      public_slug: "good-executive-assistant-acme",
      title: "Executive Assistant",
    });

    const store: JobStore = {
      ...realStore,
      upsert: (job, jobTarget) => {
        if (job.public_slug === poison.public_slug) {
          throw new Error("NOT NULL constraint failed: jobs.title_norm");
        }

        return realStore.upsert(job, jobTarget);
      },
    };

    setSetting(db, clock, "jobs.pull_failures", "2", "system:test");

    const source = createFakeJobSource({
      pages: [{ ignoredParams: [], jobs: [poison, good], total: 2 }],
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock,
      db,
      onAlert: (detail) => {
        alerts.push(detail);
      },
      source,
      store,
    });

    const result = await service.runUser("user-1");

    const [run] = db.select().from(jobPullRuns).all();

    expect(result?.failed).toBe(false);
    expect(run?.error).toBeNull();
    expect(run?.fetched).toBe(2);
    expect(run?.failed).toBe(1);
    expect(run?.kept).toBe(1);
    expect(run?.firstError).toContain(poison.public_slug);
    expect(run?.firstError).toContain("NOT NULL constraint failed: jobs.title_norm");
    expect(
      db
        .select()
        .from(jobs)
        .all()
        .map((row) => row.id),
    ).toEqual([good.public_slug]);

    const state = db.select().from(jobPullState).where(eq(jobPullState.userId, "user-1")).get();

    expect(state?.lastFullPullAt).toBe(NOW);
    expect(getSetting(db, "jobs.pull_failures")).toBe("0");

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      error: "NOT NULL constraint failed: jobs.title_norm",
      failed: 1,
      failedJob: poison.public_slug,
      mode: "full",
      userCount: 1,
    });

    const pullEvent = db
      .select()
      .from(events)
      .all()
      .find((event) => event.topic === "jobs.pull");

    expect(JSON.parse(pullEvent?.payload ?? "{}")).toMatchObject({
      counters: { failed: 1, kept: 1 },
      firstSkipped: {
        externalId: poison.external_id,
        message: "NOT NULL constraint failed: jobs.title_norm",
        publicSlug: poison.public_slug,
        source: poison.source,
      },
    });

    await service.runUser("user-1");

    expect(alerts).toHaveLength(1);
    expect(db.select().from(jobPullRuns).all()).toHaveLength(2);
    expect(getSetting(db, "jobs.pull_failures")).toBe("0");
  });

  test("a source HTTP failure still fails the pull and alerts as before", async () => {
    const { db } = migrated();
    const alerts: Record<string, string | number | boolean | null>[] = [];

    seedUser(db, { id: "user-1" });

    const source = createFakeJobSource({
      search: async () =>
        await Promise.reject(
          new JobSourceError(503, "freehire answered HTTP 503 for /api/v1/jobs/search"),
        ),
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => NOW },
      db,
      onAlert: (detail) => {
        alerts.push(detail);
      },
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    await service.runUser("user-1");

    const [run] = db.select().from(jobPullRuns).all();

    expect(run?.error).toContain("freehire answered HTTP 503 for /api/v1/jobs/search");
    expect(run?.failed).toBe(0);
    expect(run?.firstError).toBeNull();
    expect(getSetting(db, "jobs.pull_failures")).toBe("1");
    expect(db.select().from(jobPullState).all()).toHaveLength(0);
    expect(alerts).toHaveLength(0);

    await service.runUser("user-1");
    await service.runUser("user-1");

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      error: "freehire answered HTTP 503 for /api/v1/jobs/search",
      failures: 3,
      mode: "full",
      userCount: 1,
    });
  });

  test("a still-failing pull alerts again after six hours with the current failure count", async () => {
    const { db } = migrated();
    const alerts: Record<string, string | number | boolean | null>[] = [];
    let now = NOW;

    seedUser(db, { id: "user-1" });

    const source = createFakeJobSource({
      search: async () => await Promise.reject(new Error("freehire is down")),
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => now },
      db,
      onAlert: (detail) => {
        alerts.push(detail);
      },
      source,
      store: createJobStore({ clock: { now: () => now }, db }),
    });

    await service.runTick(now);
    await service.runTick(now);
    await service.runTick(now);

    expect(alerts).toHaveLength(1);

    now = NOW + 5 * 60 * 60_000;
    await service.runTick(now);

    expect(alerts).toHaveLength(1);

    now = NOW + 6 * 60 * 60_000;
    await service.runTick(now);

    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({ error: "freehire is down", failures: 5 });
  });

  test("a still-failing pull alerts again after 24 more failures without waiting six hours", async () => {
    const { db } = migrated();
    const alerts: Record<string, string | number | boolean | null>[] = [];

    seedUser(db, { id: "user-1" });

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
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    const failOneTick: (remaining: number) => Promise<void> = async (remaining) => {
      if (remaining === 0) {
        return;
      }

      await service.runTick(NOW);

      return failOneTick(remaining - 1);
    };

    await failOneTick(26);

    expect(alerts).toHaveLength(1);

    await service.runTick(NOW);

    expect(alerts).toHaveLength(2);
    expect(alerts[1]?.failures).toBe(27);
  });

  test("a successful pull resets the counter, so the next streak alerts again", async () => {
    const { db } = migrated();
    const alerts: Record<string, string | number | boolean | null>[] = [];
    let broken = true;

    seedUser(db, { id: "user-1" });

    const source = createFakeJobSource({
      pages: [{ ignoredParams: [], jobs: [], total: 0 }],
      search: async () =>
        broken
          ? await Promise.reject(new Error("freehire is down"))
          : await Promise.resolve({ ignoredParams: [], jobs: [], total: 0 }),
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => NOW },
      db,
      onAlert: (detail) => {
        alerts.push(detail);
      },
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    await service.runTick(NOW);
    await service.runTick(NOW);
    await service.runTick(NOW);

    expect(alerts).toHaveLength(1);

    broken = false;
    await service.runUser("user-1");

    expect(getSetting(db, "jobs.pull_failures")).toBe("0");
    expect(getSetting(db, "jobs.pull_alerted_failures")).toBe("0");

    broken = true;
    await service.runUser("user-1");
    await service.runUser("user-1");
    await service.runUser("user-1");

    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({ failures: 3 });
  });

  test("the alert carries a truncated error with no URL credentials", async () => {
    const { db } = migrated();
    const alerts: Record<string, string | number | boolean | null>[] = [];

    seedUser(db, { id: "user-1" });

    const source = createFakeJobSource({
      search: async () =>
        await Promise.reject(
          new Error(`fetch https://user:secret@freehire.me/jobs failed: ${"x".repeat(400)}`),
        ),
    });

    const service = createPullService({
      applyTarget: async (job) => await Promise.resolve(target(job)),
      clock: { now: () => NOW },
      db,
      onAlert: (detail) => {
        alerts.push(detail);
      },
      source,
      store: createJobStore({ clock: { now: () => NOW }, db }),
    });

    await service.runTick(NOW);
    await service.runTick(NOW);
    await service.runTick(NOW);

    const error = String(alerts[0]?.error ?? "");

    expect(error).toHaveLength(300);
    expect(error).toContain("https://[redacted]@freehire.me/jobs failed");
    expect(error).not.toContain("secret");
    expect(getSetting(db, "jobs.pull_last_error")).toBe(error);
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

describe("a user pull scores after it finishes", () => {
  test("queues the match pool once the pull returns, so an earlier empty score run is repeated", async () => {
    const { db } = migrated();

    const clock = { now: () => NOW };

    const keys = [
      ["matching.score.pool:user-1", "matching.score.pool"],
      ["jobs.pull.user:user-1", "jobs.pull.user"],
    ] as const;

    for (const [key] of keys) {
      db.insert(bgJobs)
        .values({
          createdAt: NOW,
          dedupeKey: key,
          id: crypto.randomUUID(),
          kind: "done",
          maxAttempts: 1,
          payload: "{}",
          priority: 0,
          runAt: NOW,
          status: "done",
          updatedAt: NOW,
        })
        .run();
    }

    const service: PullService = {
      jobIsOpen: async () => await Promise.resolve(false),
      runChanges: async () => await Promise.resolve(0),
      runTick: async () => await Promise.resolve(0),
      runUser: async () =>
        await Promise.resolve({
          counters: {
            droppedClosed: 0,
            droppedDuplicate: 0,
            droppedNoLink: 0,
            droppedUnsupported: 0,
            failed: 0,
            fetched: 0,
            kept: 0,
          },
          failed: false,
        }),
    };

    const handlers = createPullJobHandlers(db, clock, service);

    const previous = Bun.env.ENABLE_TEST_ROUTES;

    Bun.env.ENABLE_TEST_ROUTES = "false";

    try {
      await handlers["jobs.pull.user"](JSON.stringify({ userId: "user-1" }));
    } finally {
      if (previous === undefined) {
        delete Bun.env.ENABLE_TEST_ROUTES;
      } else {
        Bun.env.ENABLE_TEST_ROUTES = previous;
      }
    }

    const queued = db
      .select()
      .from(bgJobs)
      .all()
      .filter((row) => row.status === "queued");

    expect(queued.map((row) => row.kind)).toContain("matching.score.pool");
  });
});
