import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TargetsInput } from "../../shared/targets.ts";

import { createCandidateService } from "./candidates.ts";
import { recordPostingFailure } from "./posting-flags.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { profiles, users } from "../platform/db/schema.ts";
import { companies, companyBoards, postingTags, postings } from "../platform/db/catalog-schema.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";

const NOW = 1_800_000_000_000;

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const BASE_TARGETS = {
  locations: ["city:de:berlin"],
  unresolvedLocations: [],
  unresolvedRoles: [],
} satisfies Omit<TargetsInput, "roles">;

interface SeedTag {
  dimension: "role" | "subrole" | "granular_role" | "seniority";
  value: string;
}

const NURSE_TAGS = [
  { dimension: "role", value: "healthcare" },
  { dimension: "subrole", value: "healthcare/nursing" },
  { dimension: "granular_role", value: "health.rn" },
] as const satisfies readonly SeedTag[];

interface SeedOverrides {
  workplace?: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType?: "full_time" | "unknown";
  language?: string | null;
  seniority?: string | null;
  city?: string | null;
  countryCode?: string | null;
  region?: string | null;
  locationRaw?: string | null;
}

function seedPosting(
  catalog: ReturnType<typeof openCatalogDatabase>,
  id: string,
  title: string,
  roleTags: readonly SeedTag[],
  overrides: SeedOverrides = {},
) {
  const seniority = overrides.seniority === undefined ? "senior" : overrides.seniority;

  catalog.db
    .insert(postings)
    .values({
      applySupported: true,
      applyUrl: `https://boards.example/jobs/${id}/apply`,
      applyUrlNorm: `https://boards.example/jobs/${id}/apply`,
      ats: "greenhouse",
      atsJobId: id,
      boardId: "board-1",
      city: overrides.city === undefined ? "Berlin" : overrides.city,
      closedAt: null,
      companyId: "company-1",
      countryCode: overrides.countryCode === undefined ? "DE" : overrides.countryCode,
      dedupeKey: `greenhouse:${id}`,
      employmentType: overrides.employmentType ?? "full_time",
      firstSeenAt: NOW,
      id,
      language: overrides.language === undefined ? "English" : overrides.language,
      lastSeenAt: NOW,
      locationRaw: overrides.locationRaw === undefined ? "Berlin, Germany" : overrides.locationRaw,
      postedAt: NOW - 1000,
      region: overrides.region === undefined ? "Berlin" : overrides.region,
      status: "open",
      title,
      titleNorm: title.toLowerCase(),
      url: `https://boards.example/jobs/${id}`,
      workplace: overrides.workplace ?? "onsite",
    })
    .run();
  catalog.db
    .insert(postingTags)
    .values([
      ...roleTags.map((tag) => ({
        dimension: tag.dimension,
        postingId: id,
        source: "rules" as const,
        value: tag.value,
      })),
      ...(seniority === null
        ? []
        : [
            {
              dimension: "seniority" as const,
              postingId: id,
              source: "rules" as const,
              value: seniority,
            },
          ]),
    ])
    .run();
}

function fresh() {
  const directory = mkdtempSync(join(tmpdir(), "candidates-"));
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
      email: "candidates@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Candidates",
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

  catalog.db
    .insert(companies)
    .values({
      createdAt: NOW,
      domain: "candidates.example",
      id: "company-1",
      industry: "Health",
      name: "Candidates Co",
      nameNorm: "candidates co",
    })
    .run();
  catalog.db
    .insert(companyBoards)
    .values({
      ats: "greenhouse",
      boardToken: "candidates",
      companyId: "company-1",
      createdAt: NOW,
      id: "board-1",
      source: "v1_seed",
    })
    .run();

  seedPosting(catalog, "registered-nurse", "Registered Nurse", NURSE_TAGS);
  seedPosting(catalog, "nurse-practitioner", "Nurse Practitioner", [
    { dimension: "role", value: "healthcare" },
    { dimension: "subrole", value: "healthcare/nursing" },
    { dimension: "granular_role", value: "health.np" },
  ]);
  seedPosting(catalog, "software", "Software Engineer", [
    { dimension: "role", value: "software-it" },
    { dimension: "subrole", value: "software-it/software-engineering" },
    { dimension: "granular_role", value: "sw.general" },
  ]);
  seedPosting(catalog, "civil", "Civil Engineer", [
    { dimension: "role", value: "engineering" },
    { dimension: "subrole", value: "engineering/civil" },
    { dimension: "granular_role", value: "eng.civil" },
  ]);
  seedPosting(catalog, "platform", "Platform Engineer", [
    { dimension: "role", value: "software-it" },
  ]);

  const candidates = createCandidateService({
    catalogDb: catalog.db,
    clock,
    db: app.db,
    personal: createPersonalCrypto(app.db, masterKeyringFor(new Uint8Array(32).fill(9))),
  });

  return { app, candidates, catalog, clock };
}

async function rankedIds(roles: readonly string[]) {
  const { candidates } = fresh();

  const rows = await candidates.ranked("user-1", { ...BASE_TARGETS, roles: [...roles] }, [
    "English",
  ]);

  return rows.map((row) => row.id);
}

describe("candidate matching on role-taxonomy ids", () => {
  test("a granular_role-tagged Posting enters the pool and carries its role id", async () => {
    const { candidates } = fresh();

    const rows = await candidates.ranked(
      "user-1",
      { ...BASE_TARGETS, roles: ["Registered Nurse"] },
      ["English"],
    );

    expect(rows.map((row) => row.id)).toEqual(["registered-nurse"]);
    expect(rows.at(0)?.tags).toContainEqual({
      dimension: "granular_role",
      value: "health.rn",
    });
  });

  test("a role target admits only that role, never a neighbour that needs another licence", async () => {
    expect(await rankedIds(["Registered Nurse"])).toEqual(["registered-nurse"]);
    expect(await rankedIds(["health.rn"])).toEqual(["registered-nurse"]);
  });

  test("a subcategory or category target reaches every role inside it", async () => {
    expect((await rankedIds(["healthcare/nursing"])).toSorted()).toEqual([
      "nurse-practitioner",
      "registered-nurse",
    ]);
    expect((await rankedIds(["Software Engineering"])).toSorted()).toEqual([
      "platform",
      "software",
    ]);
  });

  test("a free-text target matches every word of the title", async () => {
    expect(await rankedIds(["Engineer Platform"])).toEqual(["platform"]);
    expect(await rankedIds(["Engineer Platfor"])).toEqual([]);
  });

  test("picking a category and a role matches the union, never double-counting", async () => {
    expect(await rankedIds(["Registered Nurse", "sw.general"])).toEqual([
      "registered-nurse",
      "software",
    ]);
  });

  test("an exact role ranks above its subcategory, which ranks above its category", async () => {
    const ids = await rankedIds(["health.rn", "healthcare/nursing", "software-it"]);

    expect(ids.slice(0, 2)).toEqual(["registered-nurse", "nurse-practitioner"]);
    expect(ids.slice(2).toSorted()).toEqual(["platform", "software"]);
  });
});

describe("the filter order one Posting reports", () => {
  test("a closed Posting reports closed before a role the person did not target", async () => {
    const { candidates, catalog } = fresh();

    catalog.db
      .update(postings)
      .set({ closedAt: NOW, status: "closed" })
      .where(eq(postings.id, "software"))
      .run();

    const result = await candidates.check("user-1", "software");

    expect(result).toBe("closed");
  });

  test("a flagged Posting leaves the pool before its role is judged", async () => {
    const { app, candidates, clock } = fresh();

    recordPostingFailure(app.db, clock, {
      postingId: "software",
      reason: "unsupported_login_required",
    });

    const result = await candidates.check("user-1", "software");

    expect(result).toBe("flagged");
  });
});

describe("remote target locations match without prior work_auth", () => {
  test("picking 'Remote' matches remote postings worldwide or in any country without work_auth", async () => {
    const { candidates, catalog } = fresh();

    seedPosting(catalog, "remote-us", "Registered Nurse", NURSE_TAGS, {
      city: null,
      countryCode: "US",
      locationRaw: "Remote, United States",
      region: null,
      workplace: "remote",
    });
    seedPosting(catalog, "remote-world", "Registered Nurse", NURSE_TAGS, {
      city: null,
      countryCode: null,
      locationRaw: "Remote",
      region: null,
      workplace: "remote",
    });
    seedPosting(catalog, "remote-eu", "Registered Nurse", NURSE_TAGS, {
      city: null,
      countryCode: null,
      locationRaw: "Remote, Europe",
      region: null,
      workplace: "remote",
    });

    const anyRemote = await candidates.ranked(
      "user-1",
      {
        ...BASE_TARGETS,
        locations: ["remote:worldwide"],
        roles: ["Registered Nurse"],
      },
      ["English"],
    );

    expect(anyRemote.map((row) => row.id).toSorted()).toEqual([
      "remote-eu",
      "remote-us",
      "remote-world",
    ]);

    const euRemote = await candidates.ranked(
      "user-1",
      {
        ...BASE_TARGETS,
        locations: ["remote:continent:EU"],
        roles: ["Registered Nurse"],
      },
      ["English"],
    );

    expect(euRemote.map((row) => row.id)).toContain("remote-eu");

    const canadaOnly = await candidates.ranked(
      "user-1",
      {
        ...BASE_TARGETS,
        locations: ["country:ca"],
        roles: ["Registered Nurse"],
      },
      ["English"],
    );

    expect(canadaOnly).toEqual([]);
  });
});
