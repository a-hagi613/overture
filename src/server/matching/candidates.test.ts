import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TargetsInput } from "../../shared/targets.ts";

import { createCandidateService } from "./candidates.ts";
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
  seniorities: ["senior"],
  workplaces: ["onsite"],
  locations: ["Berlin, Germany"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: null,
  salaryCurrency: null,
  salaryPeriod: "year",
} satisfies Omit<TargetsInput, "roles">;

interface SeedTag {
  dimension: "role" | "subrole" | "granular_role" | "seniority";
  value: string;
}

interface SeedOverrides {
  workplace?: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType?: "full_time" | "unknown";
  language?: string | null;
  seniority?: string | null;
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
      city: "Berlin",
      closedAt: null,
      companyId: "company-1",
      countryCode: "DE",
      dedupeKey: `greenhouse:${id}`,
      employmentType: overrides.employmentType ?? "full_time",
      firstSeenAt: NOW,
      id,
      language: overrides.language === undefined ? "English" : overrides.language,
      lastSeenAt: NOW,
      locationRaw: "Berlin, Germany",
      postedAt: NOW - 1000,
      region: "Berlin",
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

  seedPosting(catalog, "registered-nurse", "Registered Nurse", [
    { dimension: "role", value: "Healthcare" },
    { dimension: "granular_role", value: "Registered Nurse" },
  ]);
  seedPosting(catalog, "nurse-practitioner", "Nurse Practitioner", [
    { dimension: "role", value: "Healthcare" },
    { dimension: "granular_role", value: "Nurse Practitioner" },
  ]);
  seedPosting(catalog, "software", "Software Engineer", [
    { dimension: "role", value: "Software Engineering" },
    { dimension: "granular_role", value: "Software Engineer" },
  ]);
  seedPosting(catalog, "civil", "Civil Engineer", [
    { dimension: "role", value: "Civil Engineering" },
  ]);
  seedPosting(catalog, "platform", "Platform Engineer", [
    { dimension: "role", value: "Platform Engineer" },
  ]);

  const candidates = createCandidateService({
    catalogDb: catalog.db,
    clock,
    db: app.db,
    personal: createPersonalCrypto(app.db, masterKeyringFor(new Uint8Array(32).fill(9))),
  });

  return { candidates, catalog, clock };
}

async function rankedIds(roles: readonly string[]) {
  const { candidates } = fresh();

  const rows = await candidates.ranked("user-1", { ...BASE_TARGETS, roles: [...roles] }, [
    "English",
  ]);

  return rows.map((row) => row.id);
}

describe("candidate matching with Level-2 ESCO roles", () => {
  test("a granular_role-tagged Posting enters the pool and carries its granular tag", async () => {
    const { candidates } = fresh();

    const rows = await candidates.ranked(
      "user-1",
      { ...BASE_TARGETS, roles: ["Registered Nurse"] },
      ["English"],
    );

    expect(rows.map((row) => row.id)).toEqual(["registered-nurse"]);
    expect(rows.at(0)?.tags).toContainEqual({
      dimension: "granular_role",
      value: "Registered Nurse",
    });
  });

  test("a known Level-2 role does not cross-match a different role that shares a word", async () => {
    expect(await rankedIds(["Registered Nurse"])).toEqual(["registered-nurse"]);
    expect(await rankedIds(["Software Engineering"])).toEqual(["software"]);
  });

  test("a free-text target keeps the existing word-overlap behaviour", async () => {
    expect(await rankedIds(["Platform"])).toEqual(["platform"]);
  });

  test("picking a category and a granular role matches the union, never double-counting", async () => {
    expect(await rankedIds(["Registered Nurse", "Software Engineering"])).toEqual([
      "registered-nurse",
      "software",
    ]);
  });
});

describe("a Posting missing an optional field is still matched", () => {
  const nurse = [
    { dimension: "role", value: "Healthcare" },
    { dimension: "granular_role", value: "Registered Nurse" },
  ] as const satisfies readonly SeedTag[];

  async function idsFor(overrides: SeedOverrides, targets: Partial<TargetsInput> = {}) {
    const { candidates, catalog } = fresh();

    seedPosting(catalog, "gap", "Registered Nurse", nurse, overrides);

    const rows = await candidates.ranked(
      "user-1",
      { ...BASE_TARGETS, roles: ["Registered Nurse"], ...targets },
      ["English"],
    );

    return rows.map((row) => row.id);
  }

  test("a title with no seniority word", async () => {
    expect(await idsFor({ seniority: null })).toContain("gap");
  });

  test("a different seniority is still filtered", async () => {
    expect(await idsFor({ seniority: "intern" })).not.toContain("gap");
  });

  test("an unknown workplace for someone open to on-site work", async () => {
    expect(await idsFor({ workplace: "unknown" })).toContain("gap");
  });

  test("an unknown workplace is never shown to someone who wants remote only", async () => {
    expect(
      await idsFor({ workplace: "unknown" }, { workplaces: ["remote"], locations: ["Germany"] }),
    ).not.toContain("gap");
  });

  test("an unknown employment type", async () => {
    expect(await idsFor({ employmentType: "unknown" })).toContain("gap");
  });

  test("no detected language", async () => {
    expect(await idsFor({ language: null })).toContain("gap");
  });

  test("a complete Posting still ranks above one with gaps", async () => {
    const ids = await idsFor({ seniority: null });

    expect(ids.indexOf("registered-nurse")).toBeLessThan(ids.indexOf("gap"));
  });
});
