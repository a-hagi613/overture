import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { WorkableManifest, WorkableSnapshotRow } from "./workable-feed.ts";

import { isKillSwitchEnabled } from "../platform/settings/index.ts";
import { targets, users, workableIngests } from "../platform/db/schema.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { contentHash } from "./content-hash.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import { dedupeKeyFor } from "./dedupe-key.ts";
import { normalizeApplyUrl, normalizeTitle } from "./normalize.ts";
import type { workableIngestReportSchema } from "./sweep-worker-protocol.ts";
import { salaryPeriodForColumn, writePostingTags } from "./tag-store.ts";
import {
  WORKABLE_MANIFEST_KEY,
  WORKABLE_TARGETS_KEY,
  workableBoardToken,
  workableManifestSchema,
  workableSnapshotRowSchema,
  workableTargetsSchema,
} from "./workable-feed.ts";

const INGEST_CHUNK = 100;
export const STALE_AFTER_MS = 26 * 3_600_000;
const ROW_DROP_SHARE = 0.2;
const stringArraySchema = z.array(z.string());

function union(values: readonly (readonly string[])[]) {
  return [...new Set(values.flat())].toSorted();
}

export type WorkableIngestReport = z.infer<typeof workableIngestReportSchema>;

export interface WorkableIngestDeps {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  objects: ObjectStore;
}

function report(partial: Partial<WorkableIngestReport>) {
  return {
    outcome: "ingested",
    snapshot: null,
    rows: 0,
    added: 0,
    updated: 0,
    closed: 0,
    closedPostingIds: [],
    ageMs: null,
    previousRows: null,
    dropped: false,
    ...partial,
  };
}

async function yieldToEventLoop() {
  await Bun.sleep(0);
}

export function buildWorkableTargets(db: AppDatabase, at: number) {
  const rows = db
    .select({
      roles: targets.roles,
      seniorities: targets.seniorities,
      workplaces: targets.workplaces,
      locations: targets.locations,
      employmentTypes: targets.employmentTypes,
    })
    .from(targets)
    .innerJoin(users, eq(users.id, targets.userId))
    .where(isNull(users.suspendedAt))
    .all();

  return workableTargetsSchema.parse({
    version: 1,
    generatedAt: new Date(at).toISOString(),
    roles: union(rows.map((row) => stringArraySchema.parse(JSON.parse(row.roles)))),
    locations: union(rows.map((row) => stringArraySchema.parse(JSON.parse(row.locations)))),
    seniorities: union(rows.map((row) => stringArraySchema.parse(JSON.parse(row.seniorities)))),
    workplaces: union(rows.map((row) => stringArraySchema.parse(JSON.parse(row.workplaces)))),
    employmentTypes: union(
      rows.map((row) => stringArraySchema.parse(JSON.parse(row.employmentTypes))),
    ),
  });
}

export async function writeWorkableTargets(deps: WorkableIngestDeps, at: number) {
  const snapshotTargets = buildWorkableTargets(deps.db, at);

  await deps.objects.put(
    WORKABLE_TARGETS_KEY,
    new TextEncoder().encode(`${JSON.stringify(snapshotTargets)}\n`),
  );

  return snapshotTargets;
}

function gzipDescription(descriptionText: string) {
  return Buffer.from(Bun.gzipSync(descriptionText));
}

function tagWrites(row: WorkableSnapshotRow) {
  const writes: {
    dimension: "role" | "subrole" | "seniority";
    value: string;
    source: "rules";
  }[] = [];

  const { tags } = row;

  if (tags.role !== null) {
    writes.push({ dimension: "role", value: tags.role, source: "rules" });
  }

  if (tags.subrole !== null) {
    writes.push({ dimension: "subrole", value: tags.subrole, source: "rules" });
  }

  if (tags.seniority !== null) {
    writes.push({ dimension: "seniority", value: tags.seniority, source: "rules" });
  }

  return writes;
}

interface BoardRef {
  boardId: string;
  companyId: string;
}

function ensureBoard(
  db: DatabaseWriter,
  now: number,
  cache: Map<string, BoardRef>,
  row: WorkableSnapshotRow,
) {
  const nameNorm = row.company.toLowerCase();
  const cached = cache.get(nameNorm);

  if (cached !== undefined) {
    return cached;
  }

  const existing = db.select().from(companies).where(eq(companies.nameNorm, nameNorm)).get();
  let companyId: string;

  if (existing === undefined) {
    companyId = crypto.randomUUID();

    db.insert(companies)
      .values({ id: companyId, name: row.company, nameNorm, createdAt: now })
      .run();
  } else {
    companyId = existing.id;

    if (existing.name !== row.company) {
      db.update(companies).set({ name: row.company }).where(eq(companies.id, companyId)).run();
    }
  }

  const boardToken = workableBoardToken(row.company);

  const board = db
    .select()
    .from(companyBoards)
    .where(
      and(
        eq(companyBoards.ats, "workable"),
        eq(companyBoards.region, "us"),
        eq(companyBoards.boardToken, boardToken),
      ),
    )
    .get();

  let boardId: string;

  if (board === undefined) {
    boardId = crypto.randomUUID();

    db.insert(companyBoards)
      .values({
        id: boardId,
        companyId,
        ats: "workable",
        boardToken,
        region: "us",
        status: "active",
        source: "import",
        createdAt: now,
      })
      .run();
  } else {
    boardId = board.id;
  }

  const ref = { boardId, companyId };

  cache.set(nameNorm, ref);

  return ref;
}

function postingValues(row: WorkableSnapshotRow, ref: BoardRef, now: number) {
  const { descriptionText, tags } = row;
  const titleNorm = normalizeTitle(row.title);

  return {
    boardId: ref.boardId,
    companyId: ref.companyId,
    ats: "workable" as const,
    atsJobId: row.reference,
    url: row.url,
    applyUrl: row.applyUrl,
    applyUrlNorm: normalizeApplyUrl(row.applyUrl),
    title: row.title,
    titleNorm,
    department: row.department,
    locationRaw: row.locationRaw,
    countryCode: tags.countryCode,
    region: tags.region,
    city: tags.city,
    language: tags.language,
    workplace: tags.workplace,
    employmentType: tags.employmentType,
    salaryMinMinor: tags.salaryMinMinor,
    salaryMaxMinor: tags.salaryMaxMinor,
    salaryCurrency: tags.salaryCurrency,
    salaryPeriod: salaryPeriodForColumn(tags.salaryPeriod),
    postedAt: row.postedAt === null ? null : Date.parse(row.postedAt),
    lastSeenAt: now,
    missingPolls: 0,
    closedAt: null,
    dedupeKey: dedupeKeyFor({
      companyId: ref.companyId,
      titleNorm,
      countryCode: tags.countryCode,
      city: tags.city,
    }),
    descriptionGz: descriptionText === "" ? null : gzipDescription(descriptionText),
    descriptionHash: descriptionText === "" ? null : contentHash(descriptionText),
    feedContentHash: contentHash(JSON.stringify(row)),
    tagSource: "rules" as const,
    taggedAt: now,
  };
}

function closeAbsentPostings(catalogDb: CatalogDatabase, now: number) {
  return catalogDb
    .update(postings)
    .set({ closedAt: now })
    .where(
      and(eq(postings.ats, "workable"), isNull(postings.closedAt), lt(postings.lastSeenAt, now)),
    )
    .returning({ id: postings.id })
    .all()
    .map((row) => row.id);
}

async function writeRows(
  catalogDb: CatalogDatabase,
  now: number,
  rows: readonly WorkableSnapshotRow[],
) {
  const cache = new Map<string, BoardRef>();
  const counts = { added: 0, updated: 0 };

  async function writeChunk(offset: number) {
    const chunk = rows.slice(offset, offset + INGEST_CHUNK);

    const delta = await retryWhenBusy(() => {
      const chunkCounts = { added: 0, updated: 0 };

      try {
        catalogDb.transaction(
          (tx) => {
            for (const row of chunk) {
              const ref = ensureBoard(tx, now, cache, row);

              const values = postingValues(row, ref, now);

              const existing = tx
                .select({ id: postings.id })
                .from(postings)
                .where(and(eq(postings.boardId, ref.boardId), eq(postings.atsJobId, row.reference)))
                .get();

              let postingId: string;

              if (existing === undefined) {
                postingId = crypto.randomUUID();

                tx.insert(postings)
                  .values({ id: postingId, firstSeenAt: now, ...values })
                  .run();
                chunkCounts.added += 1;
              } else {
                postingId = existing.id;
                tx.update(postings).set(values).where(eq(postings.id, postingId)).run();
                chunkCounts.updated += 1;
              }

              writePostingTags(tx, postingId, tagWrites(row), now);
            }
          },
          { behavior: "immediate" },
        );
      } catch (error) {
        cache.clear();

        throw error;
      }

      return chunkCounts;
    }, "catalog.workable.ingest");

    counts.added += delta.added;
    counts.updated += delta.updated;

    const next = offset + chunk.length;

    if (next < rows.length) {
      await yieldToEventLoop();
      await writeChunk(next);
    }
  }

  await writeChunk(0);

  return counts;
}

function parseSnapshot(bytes: Uint8Array<ArrayBuffer>) {
  const text = new TextDecoder().decode(Bun.gunzipSync(bytes));
  const rows: WorkableSnapshotRow[] = [];

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    rows.push(workableSnapshotRowSchema.parse(JSON.parse(line)));
  }

  return rows;
}

export async function runWorkableIngest(deps: WorkableIngestDeps) {
  const { db, catalogDb, clock, objects } = deps;
  const now = clock.now();

  if (isKillSwitchEnabled(db, "ats", "workable")) {
    return report({ outcome: "kill_switch" });
  }

  await writeWorkableTargets(deps, now);

  const manifestBytes = await objects.get(WORKABLE_MANIFEST_KEY);

  if (manifestBytes === null) {
    return report({ outcome: "missing_manifest" });
  }

  const manifest: WorkableManifest = workableManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(manifestBytes)),
  );

  const ageMs = now - Date.parse(manifest.fetchedAt);

  const previous = db
    .select()
    .from(workableIngests)
    .orderBy(desc(workableIngests.ingestedAt))
    .limit(1)
    .get();

  const logged = db
    .select({ id: workableIngests.id })
    .from(workableIngests)
    .where(eq(workableIngests.snapshotKey, manifest.snapshot))
    .get();

  const dropped =
    previous !== undefined &&
    previous.rows > 0 &&
    manifest.rows < previous.rows * (1 - ROW_DROP_SHARE);

  if (logged !== undefined) {
    return report({
      outcome: "already_ingested",
      snapshot: manifest.snapshot,
      rows: manifest.rows,
      ageMs,
      previousRows: previous?.rows ?? null,
      dropped,
    });
  }

  if (previous !== undefined && previous.contentHash === manifest.contentHash) {
    db.transaction(
      (tx) => {
        tx.insert(workableIngests)
          .values({
            id: crypto.randomUUID(),
            snapshotKey: manifest.snapshot,
            fetchedAt: Date.parse(manifest.fetchedAt),
            sourceLastModified: manifest.sourceLastModified,
            rows: manifest.rows,
            contentHash: manifest.contentHash,
            added: 0,
            updated: 0,
            closed: 0,
            ingestedAt: now,
          })
          .run();
      },
      { behavior: "immediate" },
    );

    return report({
      outcome: "unchanged",
      snapshot: manifest.snapshot,
      rows: manifest.rows,
      ageMs,
      previousRows: previous.rows,
      dropped,
    });
  }

  const snapshotBytes = await objects.get(manifest.snapshot);

  if (snapshotBytes === null) {
    return report({
      outcome: "missing_snapshot",
      snapshot: manifest.snapshot,
      rows: manifest.rows,
      ageMs,
      previousRows: previous?.rows ?? null,
      dropped,
    });
  }

  const rows = parseSnapshot(snapshotBytes);
  const counts = await writeRows(catalogDb, now, rows);
  const closedPostingIds = dropped ? [] : closeAbsentPostings(catalogDb, now);

  db.transaction(
    (tx) => {
      tx.insert(workableIngests)
        .values({
          id: crypto.randomUUID(),
          snapshotKey: manifest.snapshot,
          fetchedAt: Date.parse(manifest.fetchedAt),
          sourceLastModified: manifest.sourceLastModified,
          rows: manifest.rows,
          contentHash: manifest.contentHash,
          added: counts.added,
          updated: counts.updated,
          closed: closedPostingIds.length,
          ingestedAt: now,
        })
        .run();
    },
    { behavior: "immediate" },
  );

  return report({
    outcome: "ingested",
    snapshot: manifest.snapshot,
    rows: manifest.rows,
    added: counts.added,
    updated: counts.updated,
    closed: closedPostingIds.length,
    closedPostingIds,
    ageMs,
    previousRows: previous?.rows ?? null,
    dropped,
  });
}
