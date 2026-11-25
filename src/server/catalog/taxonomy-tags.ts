import { readFileSync } from "node:fs";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { CatalogDatabase, DatabaseWriter } from "../platform/db/client.ts";

import { postings, postingTags } from "../platform/db/catalog-schema.ts";
import { classificationKey } from "./classification-key.ts";
import { legacyTagToTaxonomy, titleNamedRole } from "./legacy-roles.ts";
import { ROLE_CATEGORIES, ROLE_SUBCATEGORIES, ROLES } from "../../shared/role-taxonomy.ts";
import { SENIORITIES, TAG_SOURCE_PRECEDENCE, TAG_SOURCES } from "../../shared/tag-taxonomy.ts";
import type { TagSource } from "../../shared/tag-taxonomy.ts";

/** The label set the committed seed and the tags it writes belong to. */
export const ROLE_LABEL_VERSION = "roles-272-v1";

const ROLE_LABEL_SEED_URL = new URL("tag-data/role-labels.json", import.meta.url);

const JUNK = "JUNK";

const confidenceSchema = z.enum(["h", "m", "l"]);

const seedSchema = z.object({
  version: z.literal(ROLE_LABEL_VERSION),
  labels: z.record(
    z.string(),
    z.tuple([z.string().min(1), confidenceSchema, z.enum(SENIORITIES).nullable()]),
  ),
});

/** One title's AI role label: a role id, or `JUNK` for a posting that is not a real job. */
export interface RoleLabel {
  readonly role: string;
  readonly confidence: z.infer<typeof confidenceSchema>;
  readonly seniority: (typeof SENIORITIES)[number] | null;
}

const roleById = new Map(ROLES.map((role) => [role.id, role]));

const CONFIDENCE_WEIGHT = { h: 1, m: 0.7, l: 0.4 } as const;

/**
 * The key a role label is stored under: the classification key of the title and department, so every Posting that
 * shares a title template shares one label.
 * @param title The raw title.
 * @param department The raw department, or null.
 * @returns The label key.
 */
export function roleLabelKey(title: string, department: string | null) {
  return classificationKey(title, department).key;
}

/**
 * Parses a role label seed file.
 * @param text The file's JSON text.
 * @returns The labels by key; labels naming an unknown role are dropped.
 */
export function parseRoleLabelSeed(text: string) {
  const parsed = seedSchema.parse(JSON.parse(text));
  const labels = new Map<string, RoleLabel>();

  for (const [key, [role, confidence, seniority]] of Object.entries(parsed.labels)) {
    if (role === JUNK || roleById.has(role)) {
      labels.set(key, { role, confidence, seniority });
    }
  }

  return labels;
}

/**
 * Reads the committed seed: one Claude Haiku pass over the catalog's title templates (issue #660), so labels cost
 * nothing at run time.
 * @returns The labels by key.
 */
export function readRoleLabelSeed() {
  return parseRoleLabelSeed(readFileSync(ROLE_LABEL_SEED_URL, "utf8"));
}

let committedLabels: ReadonlyMap<string, RoleLabel> | null = null;

/**
 * The committed seed, read once per process, for writers that tag one Posting at a time (the board poll, imports).
 * @returns The labels by key.
 */
export function committedRoleLabels() {
  committedLabels ??= readRoleLabelSeed();

  return committedLabels;
}

export interface TaxonomyTagReport {
  readonly postings: number;
  readonly labelled: number;
  readonly categoryOnly: number;
  readonly titled: number;
  readonly bridged: number;
  readonly junk: number;
  readonly untagged: number;
}

interface PostingRow {
  readonly id: string;
  readonly title: string;
  readonly department: string | null;
  readonly primaryCategory: string | null;
  readonly primaryRole: string | null;
}

const postingRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string().nullable(),
  primaryCategory: z.string().nullable(),
  primaryRole: z.string().nullable(),
});

const tagRowSchema = z.object({
  postingId: z.string(),
  dimension: z.string(),
  value: z.string(),
  source: z.enum(TAG_SOURCES),
});

/**
 * A Posting's role tags as written before the rewrite (the old category, software subrole and ESCO role, or ids) and
 * the source that wrote them. Only the strongest source's tags are kept (`TAG_SOURCE_PRECEDENCE`), so an operator's
 * import is never mixed with a weaker label; `source` is null when the Posting has no role tag.
 */
export interface LegacyTags {
  readonly role: string | null;
  readonly subrole: string | null;
  readonly granularRole: string | null;
  readonly source: TagSource | null;
}

const NO_LEGACY_TAGS: LegacyTags = { role: null, subrole: null, granularRole: null, source: null };

const LEGACY_FIELD = { role: "role", subrole: "subrole", granular_role: "granularRole" } as const;

function withLegacyTag(
  entry: LegacyTags,
  tag: { dimension: string; value: string; source: TagSource },
) {
  if (
    tag.dimension !== "role" &&
    tag.dimension !== "subrole" &&
    tag.dimension !== "granular_role"
  ) {
    return entry;
  }

  const held = entry.source === null ? 0 : TAG_SOURCE_PRECEDENCE[entry.source];
  const rank = TAG_SOURCE_PRECEDENCE[tag.source];

  if (rank < held) {
    return entry;
  }

  const base = rank > held ? { ...NO_LEGACY_TAGS, source: tag.source } : entry;
  const field = LEGACY_FIELD[tag.dimension];

  return base[field] === null ? { ...base, [field]: tag.value } : base;
}

const categoryIds = new Set<string>(ROLE_CATEGORIES.map((category) => category.id));
const subcategoryIds = new Set(ROLE_SUBCATEGORIES.map((sub) => sub.id));

interface TaxonomyTags {
  readonly categoryId: string | null;
  readonly subcategoryId: string | null;
  readonly roleId: string | null;
  readonly weight: number;
  readonly source: TagSource;
}

function fromLabel(label: RoleLabel) {
  const role = roleById.get(label.role);

  if (role === undefined) {
    return null;
  }

  const weight = CONFIDENCE_WEIGHT[label.confidence];

  if (label.confidence === "l") {
    return {
      categoryId: role.categoryId,
      subcategoryId: null,
      roleId: null,
      weight,
      source: "llm",
    } satisfies TaxonomyTags;
  }

  return {
    categoryId: role.categoryId,
    subcategoryId: role.subcategoryId,
    roleId: role.id,
    weight,
    source: "llm",
  } satisfies TaxonomyTags;
}

function fromLegacy(posting: PostingRow, legacy: LegacyTags) {
  const source = legacy.source ?? "rules";
  const written = legacy.granularRole === null ? undefined : roleById.get(legacy.granularRole);

  if (written !== undefined) {
    return {
      categoryId: written.categoryId,
      subcategoryId: written.subcategoryId,
      roleId: written.id,
      weight: 0.5,
      source,
    } satisfies TaxonomyTags;
  }

  if (legacy.role !== null && categoryIds.has(legacy.role)) {
    return {
      categoryId: legacy.role,
      subcategoryId:
        legacy.subrole !== null && subcategoryIds.has(legacy.subrole) ? legacy.subrole : null,
      roleId: null,
      weight: 0.5,
      source,
    } satisfies TaxonomyTags;
  }

  const namedId = titleNamedRole(legacy.granularRole ?? "") ?? titleNamedRole(legacy.role ?? "");
  const named = namedId === null ? undefined : roleById.get(namedId);

  if (named !== undefined) {
    return {
      categoryId: named.categoryId,
      subcategoryId: named.subcategoryId,
      roleId: named.id,
      weight: 0.5,
      source,
    } satisfies TaxonomyTags;
  }

  const mapped = legacyTagToTaxonomy({
    category: posting.primaryCategory ?? legacy.role,
    role: posting.primaryRole ?? legacy.granularRole,
    subrole: legacy.subrole,
  });

  const role = mapped.roleId === null ? undefined : roleById.get(mapped.roleId);

  return {
    categoryId: mapped.categoryId,
    subcategoryId: role?.subcategoryId ?? null,
    roleId: role?.id ?? null,
    weight: 0.5,
    source,
  } satisfies TaxonomyTags;
}

type TaxonomyOutcome = "labelled" | "categoryOnly" | "titled" | "bridged" | "junk" | "untagged";

function fromTitle(posting: PostingRow) {
  const id = titleNamedRole(posting.title);
  const role = id === null ? undefined : roleById.get(id);

  if (role === undefined) {
    return null;
  }

  return {
    categoryId: role.categoryId,
    subcategoryId: role.subcategoryId,
    roleId: role.id,
    weight: 1,
    source: "rules",
  } satisfies TaxonomyTags;
}

interface TagRow {
  readonly dimension: "role" | "subrole" | "granular_role" | "seniority";
  readonly value: string;
  readonly source: TagSource;
  readonly weight: number;
}

interface PlannedTags {
  readonly outcome: TaxonomyOutcome;
  readonly rows: readonly TagRow[];
}

const NO_ROWS: readonly TagRow[] = [];

function taxonomyRows(posting: PostingRow, legacy: LegacyTags, seedLabel: RoleLabel | undefined) {
  const label = legacy.source === "import" ? undefined : seedLabel;

  if (label?.role === JUNK) {
    return { outcome: "junk", rows: NO_ROWS } satisfies PlannedTags;
  }

  const named = legacy.source === "import" ? null : fromTitle(posting);
  const fromSeed = label === undefined ? null : fromLabel(label);

  const refines =
    named !== null && fromSeed?.roleId !== null && fromSeed?.subcategoryId === named.subcategoryId;

  const titled = refines ? null : named;
  const labelled = titled === null ? fromSeed : null;
  const tags = titled ?? labelled ?? fromLegacy(posting, legacy);

  if (tags.categoryId === null) {
    return { outcome: "untagged", rows: NO_ROWS } satisfies PlannedTags;
  }

  const rows: TagRow[] = [
    { dimension: "role", value: tags.categoryId, source: tags.source, weight: tags.weight },
  ];

  if (tags.subcategoryId !== null) {
    rows.push({
      dimension: "subrole",
      value: tags.subcategoryId,
      source: tags.source,
      weight: tags.weight,
    });
  }

  if (tags.roleId !== null) {
    rows.push({
      dimension: "granular_role",
      value: tags.roleId,
      source: tags.source,
      weight: tags.weight,
    });
  }

  if (label?.seniority !== null && label?.seniority !== undefined) {
    rows.push({
      dimension: "seniority",
      value: label.seniority,
      source: "llm",
      weight: CONFIDENCE_WEIGHT[label.confidence],
    });
  }

  let outcome: TaxonomyOutcome = titled === null ? "bridged" : "titled";

  if (labelled !== null) {
    outcome = labelled.roleId === null ? "categoryOnly" : "labelled";
  }

  return { outcome, rows } satisfies PlannedTags;
}

/**
 * The role tags one Posting would get in the role taxonomy, without writing them: for a reader that holds a Posting
 * outside the catalog (the Workable feed pass) and must match it the way the catalog will.
 * @param posting The Posting's title, department and classifier fields.
 * @param retired Its retired role tags, each null when absent.
 * @param labels The AI labels by `roleLabelKey`.
 * @returns The category, subcategory and role tags, empty for `JUNK` or an untagged Posting.
 */
export function taxonomyRoleTags(
  posting: Omit<PostingRow, "id">,
  retired: LegacyTags,
  labels: ReadonlyMap<string, RoleLabel>,
) {
  const planned = taxonomyRows(
    { id: "", ...posting },
    retired,
    labels.get(roleLabelKey(posting.title, posting.department)),
  );

  return planned.rows
    .filter((row) => row.dimension !== "seniority")
    .map((row) => ({ dimension: row.dimension, value: row.value }));
}

/**
 * Rewrites every open Posting's role tags in the role taxonomy (category → subcategory → role ids, issue #660). A
 * title that is a role's own name (`titleNamedRole`) takes that role when the label would move it to another
 * subcategory, because the label was read from one sample job of the template and the title states what every job
 * sharing it is; a label inside the title's own subcategory is a refinement the description earned and stays.
 * Otherwise the AI label for the title template wins; a low-confidence one sets only the category, so a shaky label never
 * claims an exact role. Without a label the retired rule and classifier tags go through the legacy bridge, which
 * keeps only what they say safely, and tags already in the taxonomy stay as they are, so a second pass changes
 * nothing. A `JUNK` label (talent pool, open application, test posting) clears the role tags so the Posting matches no
 * one. An AI seniority replaces the title-rule one. A bridged tag keeps the source that wrote it. An operator's
 * imported role tags outrank the label: they go through the bridge as `import`, and the label's seniority leaves
 * theirs alone.
 * @param db The catalog database the run builds.
 * @param labels The AI labels by `roleLabelKey`.
 * @returns How each Posting was tagged.
 */
export function writeTaxonomyTags(db: CatalogDatabase, labels: ReadonlyMap<string, RoleLabel>) {
  const client = db.$client;

  const rows = z.array(postingRowSchema).parse(
    client
      .query(
        `SELECT id, title, department, primary_category AS primaryCategory, primary_role AS primaryRole
           FROM postings WHERE closed_at IS NULL`,
      )
      .all(),
  );

  const legacy = new Map<string, LegacyTags>();

  for (const tag of z.array(tagRowSchema).parse(
    client
      .query(
        `SELECT posting_id AS postingId, dimension, value, source FROM posting_tags
            WHERE dimension IN ('role', 'subrole', 'granular_role')
            ORDER BY posting_id, coalesce(weight, 1) DESC, value`,
      )
      .all(),
  )) {
    legacy.set(tag.postingId, withLegacyTag(legacy.get(tag.postingId) ?? NO_LEGACY_TAGS, tag));
  }

  const clear = client.prepare(
    "DELETE FROM posting_tags WHERE posting_id = ? AND dimension IN ('role', 'subrole', 'granular_role')",
  );

  const clearSeniority = client.prepare(
    "DELETE FROM posting_tags WHERE posting_id = ? AND dimension = 'seniority'",
  );

  const insert = client.prepare(
    "INSERT OR REPLACE INTO posting_tags (posting_id, dimension, value, source, weight) VALUES (?, ?, ?, ?, ?)",
  );

  const report = {
    postings: rows.length,
    labelled: 0,
    categoryOnly: 0,
    titled: 0,
    bridged: 0,
    junk: 0,
    untagged: 0,
  };

  const writeAll = client.transaction(() => {
    for (const posting of rows) {
      const planned = taxonomyRows(
        posting,
        legacy.get(posting.id) ?? NO_LEGACY_TAGS,
        labels.get(roleLabelKey(posting.title, posting.department)),
      );

      report[planned.outcome] += 1;
      clear.run(posting.id);

      if (planned.rows.some((row) => row.dimension === "seniority")) {
        clearSeniority.run(posting.id);
      }

      for (const row of planned.rows) {
        insert.run(posting.id, row.dimension, row.value, row.source, row.weight);
      }
    }
  });

  writeAll();

  return report satisfies TaxonomyTagReport;
}

/**
 * Rewrites one Posting's role tags in the role taxonomy, exactly as `writeTaxonomyTags` does for a whole run, for a
 * writer that tags Postings one at a time (the board poll, an import), so every stored role tag is a taxonomy id.
 * @param db The catalog database or an open transaction on it.
 * @param postingId The Posting to retag.
 * @param labels The AI labels by `roleLabelKey`.
 * @returns How the Posting was tagged, or null when it does not exist.
 */
export function retagPosting(
  db: DatabaseWriter,
  postingId: string,
  labels: ReadonlyMap<string, RoleLabel>,
) {
  const posting = db
    .select({
      id: postings.id,
      title: postings.title,
      department: postings.department,
      primaryCategory: postings.primaryCategory,
      primaryRole: postings.primaryRole,
    })
    .from(postings)
    .where(eq(postings.id, postingId))
    .get();

  if (posting === undefined) {
    return null;
  }

  const roleDimensions = ["role", "subrole", "granular_role"] as const;

  const written = db
    .select({
      dimension: postingTags.dimension,
      value: postingTags.value,
      source: postingTags.source,
    })
    .from(postingTags)
    .where(
      and(
        eq(postingTags.postingId, postingId),
        inArray(postingTags.dimension, [...roleDimensions]),
      ),
    )
    .orderBy(desc(sql`coalesce(${postingTags.weight}, 1)`), postingTags.value)
    .all();

  let legacy = NO_LEGACY_TAGS;

  for (const tag of written) {
    legacy = withLegacyTag(legacy, tag);
  }

  const planned = taxonomyRows(
    posting,
    legacy,
    labels.get(roleLabelKey(posting.title, posting.department)),
  );

  const dimensions = planned.rows.some((row) => row.dimension === "seniority")
    ? [...roleDimensions, "seniority" as const]
    : [...roleDimensions];

  db.delete(postingTags)
    .where(and(eq(postingTags.postingId, postingId), inArray(postingTags.dimension, dimensions)))
    .run();

  for (const row of planned.rows) {
    db.insert(postingTags)
      .values({
        postingId,
        dimension: row.dimension,
        value: row.value,
        source: row.source,
        weight: row.weight,
      })
      .onConflictDoNothing()
      .run();
  }

  return planned.outcome;
}
