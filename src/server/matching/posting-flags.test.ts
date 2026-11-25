import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCandidateService } from "./candidates.ts";
import { clearPostingFlag, flaggedPostingIds, recordPostingFailure } from "./posting-flags.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { profiles, targets, users } from "../platform/db/schema.ts";
import { companies, companyBoards, postingTags, postings } from "../platform/db/catalog-schema.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import type { TargetsInput } from "../../shared/targets.ts";

const NOW = 1_800_000_000_000;

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const TARGETS: TargetsInput = {
  roles: ["software engineer"],
  seniorities: ["senior"],
  workplaces: ["onsite"],
  locations: ["Berlin, Germany"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: null,
  salaryCurrency: null,
  salaryPeriod: "year",
};

function fresh() {
  const directory = mkdtempSync(join(tmpdir(), "posting-flags-"));
  scratchDirectories.push(directory);

  const app = openDatabase(join(directory, "app.sqlite"));
  const catalog = openCatalogDatabase(join(directory, "catalog.sqlite"));

  migrateDatabase(app.db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  const clock = { now: () => NOW };

  app.db
    .insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "owner@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Owner",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();
  app.db
    .insert(profiles)
    .values({
      createdAt: new Date(NOW),
      languages: JSON.stringify(["English"]),
      updatedAt: new Date(NOW),
      userId: "user-1",
    })
    .run();
  app.db
    .insert(targets)
    .values({
      employmentTypes: JSON.stringify(TARGETS.employmentTypes),
      locations: JSON.stringify(TARGETS.locations),
      roles: JSON.stringify(TARGETS.roles),
      seniorities: JSON.stringify(TARGETS.seniorities),
      updatedAt: new Date(NOW),
      userId: "user-1",
      workplaces: JSON.stringify(TARGETS.workplaces),
    })
    .run();

  catalog.db
    .insert(companies)
    .values({
      createdAt: NOW,
      domain: "ferro.example",
      id: "company-1",
      industry: "Software",
      name: "Ferro Cloud",
      nameNorm: "ferro cloud",
    })
    .run();
  catalog.db
    .insert(companyBoards)
    .values({
      ats: "greenhouse",
      boardToken: "ferro",
      companyId: "company-1",
      createdAt: NOW,
      id: "board-1",
      source: "v1_seed",
    })
    .run();
  catalog.db
    .insert(postings)
    .values({
      applySupported: true,
      applyUrl: "https://boards.example/jobs/1/apply",
      applyUrlNorm: "https://boards.example/jobs/1/apply",
      ats: "greenhouse",
      atsJobId: "job-1",
      boardId: "board-1",
      city: "Berlin",
      closedAt: null,
      companyId: "company-1",
      countryCode: "DE",
      dedupeKey: "greenhouse:job-1",
      employmentType: "full_time",
      firstSeenAt: NOW,
      id: "posting-1",
      language: "English",
      lastSeenAt: NOW,
      locationRaw: "Berlin, Germany",
      postedAt: NOW - 1000,
      region: "Berlin",
      status: "open",
      title: "Senior Platform Engineer",
      titleNorm: "senior platform engineer",
      url: "https://boards.example/jobs/1",
      workplace: "onsite",
    })
    .run();
  catalog.db
    .insert(postingTags)
    .values([
      { dimension: "granular_role", postingId: "posting-1", source: "rules", value: "sw.general" },
      { dimension: "seniority", postingId: "posting-1", source: "rules", value: "senior" },
    ])
    .run();

  const candidates = createCandidateService({
    catalogDb: catalog.db,
    clock,
    db: app.db,
    personal: createPersonalCrypto(app.db, masterKeyringFor(new Uint8Array(32).fill(7))),
  });

  return { app, candidates, catalog, clock };
}

describe("runtime posting flags", () => {
  test("a login wall flags the Posting on the first failure", () => {
    const { app } = fresh();

    const first = recordPostingFailure(
      app.db,
      { now: () => NOW },
      {
        postingId: "posting-1",
        reason: "unsupported_login_required",
      },
    );

    expect(first).toEqual({ failCount: 1, flagged: true });
    expect([...flaggedPostingIds(app.db)]).toEqual(["posting-1"]);
  });

  test("an employer form failure needs two failures before it flags", () => {
    const { app } = fresh();
    const clock = { now: () => NOW };

    const first = recordPostingFailure(app.db, clock, {
      postingId: "posting-1",
      reason: "employer_form_failed",
    });

    expect(first).toEqual({ failCount: 1, flagged: false });
    expect(flaggedPostingIds(app.db).size).toBe(0);

    const second = recordPostingFailure(app.db, clock, {
      postingId: "posting-1",
      reason: "employer_form_failed",
    });

    expect(second).toEqual({ failCount: 2, flagged: true });
    expect([...flaggedPostingIds(app.db)]).toEqual(["posting-1"]);

    clearPostingFlag(app.db, "posting-1");
    expect(flaggedPostingIds(app.db).size).toBe(0);
  });

  test("candidate matching excludes a flagged Posting and keeps the rest of the pool", async () => {
    const { app, candidates, catalog } = fresh();
    const clock = { now: () => NOW };

    expect((await candidates.ranked("user-1", TARGETS, ["English"])).map((row) => row.id)).toEqual([
      "posting-1",
    ]);

    catalog.db
      .insert(postings)
      .values({
        applySupported: true,
        applyUrl: "https://boards.example/jobs/2/apply",
        applyUrlNorm: "https://boards.example/jobs/2/apply",
        ats: "greenhouse",
        atsJobId: "job-2",
        boardId: "board-1",
        city: "Berlin",
        companyId: "company-1",
        countryCode: "DE",
        dedupeKey: "greenhouse:job-2",
        employmentType: "full_time",
        firstSeenAt: NOW,
        id: "posting-2",
        language: "English",
        lastSeenAt: NOW,
        locationRaw: "Berlin, Germany",
        postedAt: NOW - 1000,
        region: "Berlin",
        status: "open",
        title: "Senior Platform Engineer",
        titleNorm: "senior platform engineer",
        url: "https://boards.example/jobs/2",
        workplace: "onsite",
      })
      .run();
    catalog.db
      .insert(postingTags)
      .values([
        {
          dimension: "granular_role",
          postingId: "posting-2",
          source: "rules",
          value: "sw.general",
        },
        { dimension: "seniority", postingId: "posting-2", source: "rules", value: "senior" },
      ])
      .run();

    recordPostingFailure(app.db, clock, {
      postingId: "posting-1",
      reason: "unsupported_login_required",
    });

    const ranked = await candidates.ranked("user-1", TARGETS, ["English"]);

    expect(ranked.map((row) => row.id)).toEqual(["posting-2"]);
    expect(await candidates.check("user-1", "posting-1")).toBe("flagged");
  });
});
