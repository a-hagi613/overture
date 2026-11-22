import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { tagImports } from "../platform/db/schema.ts";
import { postings } from "../platform/db/catalog-schema.ts";
import { salaryPeriodForColumn, writePostingTags } from "./tag-store.ts";
import { normalizeApplyUrl } from "./normalize.ts";

import {
  EMPLOYMENT_TYPES,
  ROLE_GROUPS,
  SENIORITIES,
  SUBROLES,
  WORKPLACES,
  salaryRangeSchema,
} from "../../shared/tag-taxonomy.ts";

export const DEFAULT_IMPORT_SOURCE = "hiring.cafe";

const IMPORT_TAG_SOURCE = "import" as const;

const tagImportRowSchema = z.object({
  apply_url: z.string().min(1),
  title: z.string().min(1).nullish(),
  company: z.string().min(1).nullish(),
  role: z.enum(ROLE_GROUPS).nullish(),
  subrole: z.enum(SUBROLES).nullish(),
  seniority: z.enum(SENIORITIES).nullish(),
  workplace: z.enum(WORKPLACES).nullish(),
  employment_type: z.enum(EMPLOYMENT_TYPES).nullish(),
  salary: salaryRangeSchema.nullish(),
});

type TagImportRow = z.infer<typeof tagImportRowSchema>;

export interface ImportTagsInput {
  content: string;
  source: string;
  uploadedBy: string;
}

export interface ImportTagsReport {
  id: string;
  source: string;
  fileSha256: string;
  rows: number;
  matched: number;
  unmatched: number;
  appliedAt: number;
}

type TagWrite = Parameters<typeof writePostingTags>[2][number];

function sha256Hex(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function parseTagImportRows(content: string) {
  const rows: TagImportRow[] = [];

  for (const [index, line] of content.split("\n").entries()) {
    if (line.trim() === "") {
      continue;
    }

    const parsed = tagImportRowSchema.safeParse(JSON.parse(line));

    if (!parsed.success) {
      throw new Error(
        `tag import line ${String(index + 1)} is invalid: ${parsed.error.issues[0]?.path.join(".") ?? ""}`,
      );
    }

    rows.push(parsed.data);
  }

  return rows;
}

function tagWritesFor(row: TagImportRow) {
  const writes: TagWrite[] = [];

  if (row.role !== null && row.role !== undefined) {
    writes.push({ dimension: "role", value: row.role, source: IMPORT_TAG_SOURCE });
  }

  if (row.subrole !== null && row.subrole !== undefined) {
    writes.push({ dimension: "subrole", value: row.subrole, source: IMPORT_TAG_SOURCE });
  }

  if (row.seniority !== null && row.seniority !== undefined) {
    writes.push({ dimension: "seniority", value: row.seniority, source: IMPORT_TAG_SOURCE });
  }

  return writes;
}

function applyRowToPosting(db: CatalogDatabase, row: TagImportRow, postingId: string, now: number) {
  const writes = tagWritesFor(row);

  if (writes.length > 0) {
    writePostingTags(db, postingId, writes, now);
  }

  const postingsUpdate = {
    ...(row.workplace !== null && row.workplace !== undefined && { workplace: row.workplace }),
    ...(row.employment_type !== null &&
      row.employment_type !== undefined && { employmentType: row.employment_type }),
    ...(row.salary !== null &&
      row.salary !== undefined && {
        salaryMinMinor: row.salary.minMinor,
        salaryMaxMinor: row.salary.maxMinor,
        salaryCurrency: row.salary.currency,
        salaryPeriod: salaryPeriodForColumn(row.salary.period),
      }),
  };

  if (Object.keys(postingsUpdate).length > 0) {
    db.update(postings).set(postingsUpdate).where(eq(postings.id, postingId)).run();
  }
}

export function importTags(
  deps: { db: AppDatabase; catalogDb: CatalogDatabase },
  clock: Clock,
  input: ImportTagsInput,
) {
  const { db, catalogDb } = deps;
  const rows = parseTagImportRows(input.content);
  const now = clock.now();

  let matched = 0;

  for (const row of rows) {
    const applyUrlNorm = normalizeApplyUrl(row.apply_url);

    const matchedPostings = catalogDb
      .select({ id: postings.id })
      .from(postings)
      .where(eq(postings.applyUrlNorm, applyUrlNorm))
      .all();

    if (matchedPostings.length === 0) {
      continue;
    }

    matched += 1;

    for (const posting of matchedPostings) {
      applyRowToPosting(catalogDb, row, posting.id, now);
    }
  }

  const id = crypto.randomUUID();
  const fileSha256 = sha256Hex(input.content);

  db.insert(tagImports)
    .values({
      id,
      source: input.source,
      fileSha256,
      rows: rows.length,
      matched,
      uploadedBy: input.uploadedBy,
      appliedAt: now,
    })
    .run();

  return {
    id,
    source: input.source,
    fileSha256,
    rows: rows.length,
    matched,
    unmatched: rows.length - matched,
    appliedAt: now,
  };
}

export function readTagImports(db: AppDatabase) {
  return db.select().from(tagImports).all();
}
