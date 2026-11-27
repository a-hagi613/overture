import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { applications, onboardingPicks, users } from "../platform/db/schema.ts";
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

function seedCatalog() {
  const { db: catalogDb, sqlite } = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(catalogDb, "drizzle-catalog");
  sqlite.run(
    "INSERT INTO companies (id, name, name_norm, created_at) VALUES ('co-1', 'Northwind', 'northwind', 1)",
  );
  sqlite.run(
    "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES ('board-1', 'co-1', 'greenhouse', 'northwind', 'us', 'active', 'import', 1)",
  );

  for (const [index, title] of TITLES.entries()) {
    sqlite
      .prepare(
        `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
          location_raw, country_code, city, language, workplace, employment_type, first_seen_at, last_seen_at,
          status, apply_supported, dedupe_key)
         VALUES (?, 'board-1', 'co-1', 'greenhouse', ?, ?, ?, ?, ?, 'Toronto, ON', 'CA', 'Toronto', 'en', 'remote',
           'full_time', ?, ?, 'open', 1, ?)`,
      )
      .run(
        `posting-${String(index)}`,
        String(index),
        `https://northwind.example/${String(index)}`,
        `https://northwind.example/${String(index)}/apply`,
        title,
        title.toLowerCase(),
        NOW,
        NOW,
        `posting-${String(index)}`,
      );
  }

  return { catalogDb, sqlite };
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

  const { catalogDb, sqlite } = seedCatalog();
  const picks = createOnboardingPicks({ catalogDb, clock: createClock(), db });

  return { catalogDb, db, picks, sqlite };
}

describe("the durable pick snapshot", () => {
  test("keeps employer and title after the posting closes during the card check", () => {
    const { db, picks, sqlite } = seed();

    const saved = picks.save("user-1", ["posting-0", "posting-1", "posting-2"]);

    expect(saved?.picks.map((pick) => pick.company)).toEqual([
      "Northwind",
      "Northwind",
      "Northwind",
    ]);
    expect(saved?.picks.map((pick) => pick.title)).toEqual(TITLES.slice(0, 3));

    sqlite.run(`UPDATE postings SET status = 'closed', closed_at = ${String(NOW)}`);

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
