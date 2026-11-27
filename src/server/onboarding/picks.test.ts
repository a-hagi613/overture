import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { applications, jobs, onboardingPicks, users } from "../platform/db/schema.ts";
import { onboardingPickLimitFor, pickStatusOfApplication } from "../../shared/onboarding.ts";
import { createOnboardingPicks } from "./picks.ts";

const NOW = 1_795_735_200_000;

const TITLES = [
  "Platform Engineer",
  "Site Reliability Engineer",
  "Backend Engineer",
  "Data Engineer",
  "DevOps Engineer",
  "AI Engineer",
  "Security Engineer",
  "Mobile Engineer",
  "Frontend Engineer",
  "Infrastructure Engineer",
  "Staff Engineer",
];

function seedJobs(db: ReturnType<typeof openDatabase>["db"]) {
  for (const [index, title] of TITLES.entries()) {
    const id = `posting-${String(index)}`;

    db.insert(jobs)
      .values({
        applyUrl: `https://northwind.example/${String(index)}/apply`,
        applyVia: "direct",
        atsJobId: String(index),
        boardToken: "northwind",
        closedAt: null,
        company: "Northwind",
        companyNorm: "northwind",
        countries: '["ca"]',
        createdAt: NOW,
        dedupeKey: id,
        externalId: `northwind:${String(index)}`,
        firstSeenAt: NOW,
        freehireSource: "greenhouse",
        id,
        lastSeenAt: NOW,
        locationRaw: "Toronto, ON",
        postedAt: NOW,
        source: "greenhouse",
        status: "open",
        title,
        titleNorm: title.toLowerCase(),
        updatedAt: NOW,
        url: `https://northwind.example/${String(index)}`,
        workMode: "remote",
      })
      .run();
  }
}

function seed() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "owner@example.com",
      emailVerified: true,
      id: "user-1",
      name: "Owner",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();

  seedJobs(db);

  const picks = createOnboardingPicks({ clock: createClock(), db });

  return { db, picks };
}

describe("the durable pick snapshot", () => {
  test("keeps employer and title after the posting closes during the card check", () => {
    const { db, picks } = seed();

    const saved = picks.save("user-1", ["posting-0", "posting-1", "posting-2"]);

    expect(saved?.picks.map((pick) => pick.company)).toEqual([
      "Northwind",
      "Northwind",
      "Northwind",
    ]);
    expect(saved?.picks.map((pick) => pick.title)).toEqual(TITLES.slice(0, 3));

    db.update(jobs).set({ closedAt: NOW, status: "closed" }).where(eq(jobs.id, "posting-0")).run();

    const after = picks.view("user-1");

    expect(after.picks.map((pick) => pick.title)).toEqual(TITLES.slice(0, 3));
    expect(after.selected).toEqual(["posting-0", "posting-1", "posting-2"]);
    expect(
      db.select().from(onboardingPicks).where(eq(onboardingPicks.userId, "user-1")).all(),
    ).toHaveLength(3);
  });

  test("saving the same picks twice reuses each row instead of duplicating one", () => {
    const { db, picks } = seed();

    picks.save("user-1", ["posting-0", "posting-1", "posting-2"]);
    picks.save("user-1", ["posting-0", "posting-1", "posting-2"]);

    const rows = db
      .select()
      .from(onboardingPicks)
      .where(eq(onboardingPicks.userId, "user-1"))
      .all();

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.postingId)).size).toBe(3);
  });

  test("a pick that already owns an Application survives a later smaller selection", () => {
    const { db, picks } = seed();

    picks.save("user-1", ["posting-0", "posting-1", "posting-2"]);

    db.insert(applications)
      .values({
        applyUrl: "https://northwind.example/0/apply",
        ats: "greenhouse",
        companyId: "co-1",
        companyName: "Northwind",
        companyNameNorm: "northwind",
        createdAt: NOW,
        id: "app-1",
        origin: "manual",
        postingId: "posting-0",
        postingTitle: "Platform Engineer",
        postingUrl: "https://northwind.example/0",
        stage: "queued",
        status: "preparing",
        updatedAt: NOW,
        userId: "user-1",
      })
      .run();

    picks.applyPreparation(
      "user-1",
      new Map([
        [
          "posting-0",
          {
            applicationId: "app-1",
            postingId: "posting-0",
            reason: null,
            status: "preparing" as const,
          },
        ],
      ]),
    );

    const saved = picks.save("user-1", ["posting-1"]);

    expect(saved?.picks.map((pick) => pick.postingId)).toContain("posting-0");
    expect(saved?.picks.map((pick) => pick.postingId)).toContain("posting-1");
    expect(saved?.picks.map((pick) => pick.postingId)).not.toContain("posting-2");

    const application = db.select().from(applications).all().at(0);

    expect(application?.id).toBe("app-1");
  });

  test("the plan, not the storage, decides the pick limit", () => {
    const { picks } = seed();

    expect(picks.save("user-1", ["posting-0", "posting-1", "posting-2", "posting-3"])).toBeNull();

    picks.setPlanKind("user-1", "week");

    expect(
      picks.save("user-1", ["posting-0", "posting-1", "posting-2", "posting-3"]),
    ).not.toBeNull();
    expect(picks.view("user-1").pickLimit).toBe(10);
    expect(picks.view("user-1").planKind).toBe("week");
  });

  test("the trial refuses a fourth pick and keeps the first three", () => {
    const { picks } = seed();

    picks.setPlanKind("user-1", "free_trial");

    expect(onboardingPickLimitFor("free_trial")).toBe(3);
    expect(picks.save("user-1", ["posting-0", "posting-1", "posting-2", "posting-3"])).toBeNull();

    const saved = picks.save("user-1", ["posting-0", "posting-1", "posting-2"]);

    expect(saved?.picks).toHaveLength(3);
    expect(saved?.pickLimit).toBe(3);
    expect(saved?.planKind).toBe("free_trial");
  });

  test("a paid plan refuses an eleventh pick and accepts ten", () => {
    const { picks } = seed();

    picks.setPlanKind("user-1", "month");

    const eleven = Array.from({ length: 11 }, (_, index) => `posting-${String(index)}`);
    const ten = eleven.slice(0, 10);

    expect(onboardingPickLimitFor("month")).toBe(10);
    expect(picks.save("user-1", eleven)).toBeNull();
    expect(picks.save("user-1", ten)?.picks).toHaveLength(10);
  });
});

describe("the failure reason a pick view shows", () => {
  test("shows a stored pick failure reason and drops one the contract does not know", () => {
    const { db, picks } = seed();

    picks.save("user-1", ["posting-0", "posting-1"]);

    db.update(onboardingPicks)
      .set({ statusReason: "prepare_failed" })
      .where(eq(onboardingPicks.postingId, "posting-0"))
      .run();
    db.update(onboardingPicks)
      .set({ statusReason: "not_a_reason" })
      .where(eq(onboardingPicks.postingId, "posting-1"))
      .run();

    const byPosting = new Map(picks.view("user-1").picks.map((pick) => [pick.postingId, pick]));

    expect(byPosting.get("posting-0")?.reason).toBe("prepare_failed");
    expect(byPosting.get("posting-1")?.reason).toBeNull();
  });
});

describe("the pick status each Application gives", () => {
  test("maps preparation through a question to a finished plan", () => {
    expect(pickStatusOfApplication("preparing", null)).toBe("preparing");
    expect(pickStatusOfApplication("needs_review", "unknown_question")).toBe("needs_answer");
    expect(pickStatusOfApplication("ready", null)).toBe("prepared");
    expect(pickStatusOfApplication("approved", null)).toBe("prepared");
    expect(pickStatusOfApplication("sent", null)).toBe("prepared");
  });

  test("keeps a closed or failed posting distinct", () => {
    expect(pickStatusOfApplication("failed", "posting_closed")).toBe("closed");
    expect(pickStatusOfApplication("failed", "apply_unsupported")).toBe("failed");
    expect(pickStatusOfApplication("skipped", null)).toBe("closed");
  });
});
