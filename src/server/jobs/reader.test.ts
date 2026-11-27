import { describe, expect, test } from "bun:test";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { jobs } from "../platform/db/schema.ts";
import { eq } from "drizzle-orm";
import { createJobStore } from "./store.ts";
import { createJobReader } from "./reader.ts";
import { backfillJobLanguages } from "./backfill.ts";

const NOW = 1_800_000_000_000;

function migrated() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

const record: (overrides?: Partial<FreehireJobRecord>) => FreehireJobRecord = (overrides = {}) => {
  const publicSlug = overrides.public_slug ?? "senior-go-engineer-acme";

  return {
    apply_url: null,
    cities: ["Toronto"],
    closed_at: null,
    company: "Acme",
    company_slug: "acme",
    countries: ["ca"],
    created_at: "2026-11-20T09:00:00Z",
    description: null,
    enrichment: { category: "backend" },
    external_id: `acme:${publicSlug}`,
    location: "Toronto, Canada",
    metros: null,
    posted_at: "2026-11-20T00:00:00Z",
    public_slug: publicSlug,
    reality: null,
    regions: null,
    skills: null,
    source: "greenhouse",
    title: "Senior Go Engineer",
    url: null,
    work_mode: null,
    ...overrides,
  };
};

function storeJob(db: ReturnType<typeof migrated>, job: FreehireJobRecord) {
  createJobStore({ clock: { now: () => NOW }, db }).upsert(job, {
    applyUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
    ats: "greenhouse",
    atsJobId: "123",
    boardToken: "acme",
    via: "direct",
  });
}

describe("the freehire-shaped job read", () => {
  test("filters by category and open status", () => {
    const db = migrated();

    storeJob(db, record());
    storeJob(db, record({ public_slug: "teacher", enrichment: { category: "education" } }));

    const reader = createJobReader(db);

    const rows = reader.forPreferences({
      categories: ["backend"],
      cities: [],
      countries: [],
      languages: [],
      metros: [],
      placeIds: [],
      regions: [],
      titleWords: [],
    });

    expect(rows.map((row) => row.id)).toEqual(["senior-go-engineer-acme"]);
  });

  test("intersects the job's canonical place ids with the user's, matching freehire's geography rule", () => {
    const db = migrated();

    storeJob(db, record());
    storeJob(
      db,
      record({
        cities: ["Berlin"],
        company: "Bright",
        company_slug: "bright",
        countries: ["de"],
        external_id: "bright:7",
        public_slug: "bright-engineer",
      }),
    );

    const reader = createJobReader(db);

    const rows = reader.forPreferences({
      categories: [],
      cities: [],
      countries: [],
      metros: [],
      placeIds: ["country:de", "city:ca:toronto"],
      regions: [],
      titleWords: [],
    });

    expect(rows.map((row) => row.id).toSorted()).toEqual([
      "bright-engineer",
      "senior-go-engineer-acme",
    ]);
  });

  test("matches a title word when the category is blank or different", () => {
    const db = migrated();

    storeJob(
      db,
      record({
        enrichment: null,
        public_slug: "backend-engineer-acme",
        title: "Backend Engineer",
      }),
    );
    storeJob(
      db,
      record({
        enrichment: { category: "support" },
        public_slug: "backend-support-acme",
        title: "Backend Support Specialist",
      }),
    );
    storeJob(
      db,
      record({
        enrichment: { category: "education" },
        public_slug: "teacher",
        title: "Primary Teacher",
      }),
    );

    const reader = createJobReader(db);

    const rows = reader.forPreferences({
      categories: ["education"],
      cities: [],
      countries: [],
      languages: [],
      metros: [],
      placeIds: [],
      regions: [],
      titleWords: ["backend"],
    });

    expect(rows.map((row) => row.id).toSorted()).toEqual([
      "backend-engineer-acme",
      "backend-support-acme",
      "teacher",
    ]);
  });

  test("hides a posting written in a language the person does not read", () => {
    const db = migrated();

    storeJob(
      db,
      record({
        description:
          "私たちは急成長中のスタートアップで、バックエンドエンジニアを募集しています。チームと協力して新しいサービスを開発し、お客様に最高の体験を提供することがあなたの仕事です。経験と技術を活かして一緒に働きましょう。",
        public_slug: "japanese-backend",
      }),
    );
    storeJob(db, record({ public_slug: "english-backend", title: "Backend Engineer" }));

    const reader = createJobReader(db);

    const rows = reader.forPreferences({
      categories: ["backend"],
      cities: [],
      countries: [],
      languages: ["en"],
      metros: [],
      placeIds: [],
      regions: [],
      titleWords: [],
    });

    expect(rows.map((row) => row.id)).toEqual(["english-backend"]);
  });

  test("backfills the language on a job stored before the column existed", () => {
    const db = migrated();

    storeJob(
      db,
      record({
        description:
          "私たちは急成長中のスタートアップで、バックエンドエンジニアを募集しています。チームと協力して新しいサービスを開発し、お客様に最高の体験を提供することがあなたの仕事です。経験と技術を活かして一緒に働きましょう。",
        public_slug: "legacy-japanese",
      }),
    );
    db.update(jobs).set({ language: null }).where(eq(jobs.id, "legacy-japanese")).run();

    expect(backfillJobLanguages(db)).toBe(1);
    expect(
      db.select({ language: jobs.language }).from(jobs).where(eq(jobs.id, "legacy-japanese")).get()
        ?.language,
    ).toBe("ja");
  });

  test("hides talent pools, open applications and test postings", () => {
    const db = migrated();

    for (const [slug, title] of [
      ["talent-pool", "Talent Pool - Future Opportunities"],
      ["open-application", "Open Application"],
      ["test-posting", "Test Posting"],
      ["initiativbewerbung", "Initiativbewerbung"],
      ["candidature", "Candidature spontanée"],
      ["real-job", "Backend Engineer"],
      ["test-engineer", "Test Engineer"],
    ] as const) {
      storeJob(db, record({ public_slug: slug, title }));
    }

    const reader = createJobReader(db);

    const rows = reader.forPreferences({
      categories: ["backend"],
      cities: [],
      countries: [],
      languages: [],
      metros: [],
      placeIds: [],
      regions: [],
      titleWords: [],
    });

    expect(rows.map((row) => row.id).toSorted()).toEqual(["real-job", "test-engineer"]);
  });

  test("never returns a job a failed pull left closed", () => {
    const db = migrated();
    const job = record();

    storeJob(db, job);
    db.update(jobs)
      .set({ closedAt: NOW, status: "closed" })
      .where(eq(jobs.id, job.public_slug))
      .run();

    const reader = createJobReader(db);

    expect(
      reader.forPreferences({
        categories: [],
        cities: [],
        countries: [],
        metros: [],
        placeIds: [],
        regions: [],
        titleWords: [],
      }),
    ).toHaveLength(0);
  });

  test("a Remote · Canada user never sees a Remote US only job, and worldwide sees the country-less one", () => {
    const db = migrated();

    storeJob(db, record({ work_mode: "remote" }));
    storeJob(
      db,
      record({
        cities: ["Austin"],
        countries: ["us"],
        external_id: "bright:us",
        public_slug: "us-only",
        work_mode: "remote",
      }),
    );
    storeJob(
      db,
      record({
        cities: [],
        countries: [],
        external_id: "bright:anywhere",
        public_slug: "anywhere",
        work_mode: "remote",
      }),
    );

    const reader = createJobReader(db);

    const canada = reader.forPreferences({
      categories: [],
      cities: [],
      countries: [],
      metros: [],
      placeIds: ["city:ca:toronto", "remote:country:ca"],
      regions: [],
      titleWords: [],
    });

    expect(canada.map((row) => row.id)).toEqual(["senior-go-engineer-acme"]);

    const worldwide = reader.forPreferences({
      categories: [],
      cities: [],
      countries: [],
      metros: [],
      placeIds: ["remote:worldwide"],
      regions: [],
      titleWords: [],
    });

    expect(worldwide.map((row) => row.id)).toContain("anywhere");
  });
});
