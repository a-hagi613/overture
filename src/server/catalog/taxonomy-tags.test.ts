import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RoleLabel } from "./taxonomy-tags.ts";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import {
  parseRoleLabelSeed,
  readRoleLabelSeed,
  retagPosting,
  ROLE_LABEL_VERSION,
  roleLabelKey,
  writeTaxonomyTags,
} from "./taxonomy-tags.ts";

const NOW = 1_800_000_000_000;

const scratchDirectories: string[] = [];
const handles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }

  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

interface SeedPosting {
  id: string;
  title: string;
  department?: string | null;
  primaryCategory?: string | null;
  primaryRole?: string | null;
  closed?: boolean;
  tags?: readonly [string, string][];
}

function catalogWith(seeds: readonly SeedPosting[]) {
  const directory = mkdtempSync(join(tmpdir(), "taxonomy-tags-"));

  scratchDirectories.push(directory);

  const catalog = openCatalogDatabase(join(directory, "catalog.sqlite"));

  handles.push(catalog.sqlite);
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");
  catalog.db
    .insert(companies)
    .values({ createdAt: NOW, id: "company-1", name: "Co", nameNorm: "co" })
    .run();
  catalog.db
    .insert(companyBoards)
    .values({
      ats: "greenhouse",
      boardToken: "co",
      companyId: "company-1",
      createdAt: NOW,
      id: "board-1",
      source: "v1_seed",
    })
    .run();

  for (const seed of seeds) {
    catalog.db
      .insert(postings)
      .values({
        applySupported: true,
        applyUrlNorm: `https://boards.example/${seed.id}`,
        ats: "greenhouse",
        atsJobId: seed.id,
        boardId: "board-1",
        closedAt: seed.closed === true ? NOW : null,
        companyId: "company-1",
        dedupeKey: `greenhouse:${seed.id}`,
        department: seed.department ?? null,
        firstSeenAt: NOW,
        id: seed.id,
        lastSeenAt: NOW,
        primaryCategory: seed.primaryCategory ?? null,
        primaryRole: seed.primaryRole ?? null,
        status: seed.closed === true ? "closed" : "open",
        title: seed.title,
        titleNorm: seed.title.toLowerCase(),
        url: `https://boards.example/${seed.id}`,
      })
      .run();

    for (const [dimension, value] of seed.tags ?? []) {
      catalog.sqlite
        .prepare(
          "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, ?, ?, 'rules')",
        )
        .run(seed.id, dimension, value);
    }
  }

  return catalog;
}

function tagsOf(catalog: ReturnType<typeof catalogWith>, postingId: string) {
  return catalog.sqlite
    .query<{ dimension: string; value: string; source: string }, [string]>(
      "SELECT dimension, value, source FROM posting_tags WHERE posting_id = ? ORDER BY dimension, value",
    )
    .all(postingId)
    .map((tag) => `${tag.dimension}=${tag.value}:${tag.source}`);
}

function labels(entries: readonly [string, string | null, RoleLabel][]) {
  return new Map(
    entries.map(([title, department, label]) => [roleLabelKey(title, department), label]),
  );
}

describe("writeTaxonomyTags", () => {
  test("a confident label writes the category, subcategory and role ids and its seniority", () => {
    const catalog = catalogWith([
      {
        id: "rn",
        title: "Senior Registered Nurse - ICU",
        tags: [
          ["role", "Healthcare"],
          ["seniority", "mid"],
        ],
      },
    ]);

    const report = writeTaxonomyTags(
      catalog.db,
      labels([
        [
          "Senior Registered Nurse - ICU",
          null,
          { role: "health.rn", confidence: "h", seniority: "senior" },
        ],
      ]),
    );

    expect(tagsOf(catalog, "rn")).toEqual([
      "granular_role=health.rn:llm",
      "role=healthcare:llm",
      "seniority=senior:llm",
      "subrole=healthcare/nursing:llm",
    ]);
    expect(report).toEqual({
      postings: 1,
      labelled: 1,
      categoryOnly: 0,
      bridged: 0,
      junk: 0,
      untagged: 0,
    });
  });

  test("a low-confidence label sets only the category, so it never claims an exact role", () => {
    const catalog = catalogWith([{ id: "vague", title: "Clinical Specialist" }]);

    writeTaxonomyTags(
      catalog.db,
      labels([
        ["Clinical Specialist", null, { role: "health.rn", confidence: "l", seniority: null }],
      ]),
    );

    expect(tagsOf(catalog, "vague")).toEqual(["role=healthcare:llm"]);
  });

  test("a JUNK label clears every role tag, so the Posting matches no one", () => {
    const catalog = catalogWith([
      { id: "pool", title: "General Application", tags: [["role", "Software Engineering"]] },
    ]);

    const report = writeTaxonomyTags(
      catalog.db,
      labels([["General Application", null, { role: "JUNK", confidence: "h", seniority: null }]]),
    );

    expect(tagsOf(catalog, "pool")).toEqual([]);
    expect(report.junk).toBe(1);
  });

  test("the department is part of the key, so one title can carry two labels", () => {
    const catalog = catalogWith([
      { id: "eng", title: "Associate", department: "Engineering" },
      { id: "law", title: "Associate", department: "Legal" },
    ]);

    writeTaxonomyTags(
      catalog.db,
      labels([
        ["Associate", "Engineering", { role: "sw.general", confidence: "m", seniority: null }],
        ["Associate", "Legal", { role: "legal.lawyer", confidence: "m", seniority: null }],
      ]),
    );

    expect(tagsOf(catalog, "eng")).toContain("granular_role=sw.general:llm");
    expect(tagsOf(catalog, "law")).toContain("granular_role=legal.lawyer:llm");
  });

  test("without a label the retired tags go through the bridge, keeping only what they say safely", () => {
    const catalog = catalogWith([
      {
        id: "backend",
        title: "Backend Developer",
        tags: [
          ["role", "Software Engineering"],
          ["subrole", "Backend"],
        ],
      },
      { id: "category", title: "Something Odd", primaryCategory: "Healthcare" },
      { id: "nothing", title: "Mystery Role" },
    ]);

    const report = writeTaxonomyTags(catalog.db, new Map());

    expect(tagsOf(catalog, "backend")).toEqual([
      "granular_role=sw.backend:rules",
      "role=software-it:rules",
      "subrole=software-it/software-engineering:rules",
    ]);
    expect(tagsOf(catalog, "category")).toEqual(["role=healthcare:rules"]);
    expect(tagsOf(catalog, "nothing")).toEqual([]);
    expect(report).toMatchObject({ postings: 3, bridged: 2, untagged: 1 });
  });

  test("a second pass changes nothing, so a rebuilt or retagged catalog keeps its ids", () => {
    const catalog = catalogWith([
      {
        id: "backend",
        title: "Backend Developer",
        tags: [
          ["role", "Software Engineering"],
          ["subrole", "Backend"],
        ],
      },
      { id: "category", title: "Something Odd", primaryCategory: "Healthcare" },
      { id: "rn", title: "Registered Nurse" },
    ]);

    const seed = labels([
      ["Registered Nurse", null, { role: "health.rn", confidence: "h", seniority: null }],
    ]);

    writeTaxonomyTags(catalog.db, seed);

    const first = ["backend", "category", "rn"].map((id) => tagsOf(catalog, id));

    writeTaxonomyTags(catalog.db, seed);

    expect(["backend", "category", "rn"].map((id) => tagsOf(catalog, id))).toEqual(first);
  });

  test("leaves closed Postings alone", () => {
    const catalog = catalogWith([
      { id: "closed", title: "Registered Nurse", closed: true, tags: [["role", "Healthcare"]] },
    ]);

    const report = writeTaxonomyTags(
      catalog.db,
      labels([["Registered Nurse", null, { role: "health.rn", confidence: "h", seniority: null }]]),
    );

    expect(tagsOf(catalog, "closed")).toEqual(["role=Healthcare:rules"]);
    expect(report.postings).toBe(0);
  });
});

describe("retagPosting", () => {
  test("rewrites one Posting exactly as the whole-catalog pass does", () => {
    const catalog = catalogWith([
      {
        id: "one",
        title: "Backend Developer",
        tags: [
          ["role", "Software Engineering"],
          ["subrole", "Backend"],
        ],
      },
      {
        id: "two",
        title: "Backend Developer",
        tags: [
          ["role", "Software Engineering"],
          ["subrole", "Backend"],
        ],
      },
    ]);

    expect(retagPosting(catalog.db, "one", new Map())).toBe("bridged");
    writeTaxonomyTags(catalog.db, new Map());

    expect(tagsOf(catalog, "one")).toEqual(tagsOf(catalog, "two"));
  });

  test("applies an AI label, clears a JUNK posting, and answers null for an unknown id", () => {
    const catalog = catalogWith([
      { id: "rn", title: "Registered Nurse", tags: [["role", "Healthcare"]] },
      { id: "pool", title: "Talent Pool", tags: [["role", "Healthcare"]] },
    ]);

    const seed = labels([
      ["Registered Nurse", null, { role: "health.rn", confidence: "m", seniority: "mid" }],
      ["Talent Pool", null, { role: "JUNK", confidence: "h", seniority: null }],
    ]);

    expect(retagPosting(catalog.db, "rn", seed)).toBe("labelled");
    expect(retagPosting(catalog.db, "pool", seed)).toBe("junk");
    expect(retagPosting(catalog.db, "missing", seed)).toBeNull();
    expect(tagsOf(catalog, "rn")).toEqual([
      "granular_role=health.rn:llm",
      "role=healthcare:llm",
      "seniority=mid:llm",
      "subrole=healthcare/nursing:llm",
    ]);
    expect(tagsOf(catalog, "pool")).toEqual([]);
  });
});

describe("the role label seed", () => {
  test("parses labels and drops one naming an unknown role", () => {
    const parsed = parseRoleLabelSeed(
      JSON.stringify({
        version: ROLE_LABEL_VERSION,
        labels: {
          a: ["health.rn", "h", "senior"],
          b: ["JUNK", "m", null],
          c: ["not.a.role", "h", null],
        },
      }),
    );

    expect([...parsed.keys()]).toEqual(["a", "b"]);
    expect(parsed.get("a")).toEqual({ role: "health.rn", confidence: "h", seniority: "senior" });
  });

  test("rejects a seed from another label set", () => {
    expect(() =>
      parseRoleLabelSeed(JSON.stringify({ version: "roles-old", labels: {} })),
    ).toThrow();
  });

  test("the committed seed covers the catalog's title templates with known roles", () => {
    const seed = readRoleLabelSeed();

    expect(seed.size).toBeGreaterThan(100_000);
    expect(seed.get(roleLabelKey("Registered Nurse", null))?.role).toBe("health.rn");
  });
});
