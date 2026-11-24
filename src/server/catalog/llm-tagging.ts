import { gunzipSync } from "node:zlib";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmOutputSchema, LlmPort, LlmRequest } from "../platform/ports/llm.ts";
import { bgJobs } from "../platform/db/schema.ts";
import { companies, postings, postingTags } from "../platform/db/catalog-schema.ts";
import { yieldToEventLoop } from "../platform/db/batches.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { checkLlmCaps, nextUtcMidnight } from "../platform/llm/caps.ts";
import { recordLlmUsage } from "../platform/llm/usage.ts";
import { writePostingTags } from "./tag-store.ts";
import { normalizeTitle } from "./normalize.ts";

import { ROLE_GROUPS, SUBROLES } from "../../shared/tag-taxonomy.ts";

export const TAG_FALLBACK_JOB_KIND = "tag.llm_fallback";
export const TAG_FALLBACK_PURPOSE = "tag_fallback";

const DESCRIPTION_WORDS = 300;

/**
 * Requests one run sends. A single Anthropic batch of this size keeps the request payload well inside the 2 GB Fly
 * VM; a run that reaches it leaves the remaining leftovers to the continuation run, which the job queues itself.
 */
export const MAX_BATCH_ITEMS = 500;

/**
 * Untagged postings one run selects. The selection is the memory bound of the job: on a catalog with hundreds of
 * thousands of Postings the old unbounded read materialized every row and its description at once and the VM
 * OOM-killed the process on boot, so the SQL now stops here and the next run picks up the rest.
 */
export const LEFTOVER_SCAN_LIMIT = 2000;

/**
 * Description reads between event-loop yields. `gunzipSync` blocks the thread it runs on, so the build yields every
 * this many items and Fly's health check keeps answering during a large batch.
 */
export const YIELD_EVERY = 25;

/** A run that left leftovers behind queues its continuation a minute later instead of waiting for UTC midnight. */
const CONTINUE_DELAY_MS = 60_000;

const LLM_TAG_SOURCE: (typeof postingTags.$inferInsert)["source"] = "llm";

const SYSTEM_PROMPT = [
  "You classify job postings for a job-search tool that filters by role.",
  "For each posting choose exactly one role group, and when the group is Software Engineering also a subrole.",
  `Role groups: ${ROLE_GROUPS.join(", ")}.`,
  `Subroles for Software Engineering: ${SUBROLES.join(", ")}.`,
  "Never invent role groups or subroles outside these lists.",
  "Judge from the company, title, department and description excerpt that follow.",
  "Return the JSON the tool requests, with no other text.",
  "Set subrole to null unless the role group is Software Engineering.",
].join(" ");

const OUTPUT_SCHEMA: LlmOutputSchema = {
  type: "object",
  properties: {
    role: { type: "string", enum: [...ROLE_GROUPS] },
    subrole: { type: "string", enum: [...SUBROLES] },
  },
  required: ["role", "subrole"],
  additionalProperties: false,
};

const batchOutputSchema = z.object({
  role: z.enum(ROLE_GROUPS).nullable(),
  subrole: z.enum(SUBROLES).nullable(),
});

type BatchOutcome = z.infer<typeof batchOutputSchema>;

interface TagWrite {
  dimension: "role" | "subrole" | "seniority";
  value: string;
  source: (typeof postingTags.$inferInsert)["source"];
}

export interface TagFallbackDeps {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  llm: LlmPort;
}

export interface TagFallbackReport {
  leftovers: number;
  reused: number;
  sent: number;
  tagged: number;
  recorded: number;
  blocked: boolean;
  blockedCap: "user" | "global" | "tagging" | null;
}

/** A leftover Posting without its description: the description is fetched only for the batch's representatives. */
interface LeftoverPosting {
  id: string;
  companyId: string;
  cacheKey: string;
  companyName: string;
  title: string;
  department: string | null;
}

interface LeftoverGroup {
  cacheKey: string;
  representative: LeftoverPosting;
  postingIds: string[];
}

interface CachedTag {
  dimension: "role" | "subrole";
  value: string;
}

function descriptionWordsFor(descriptionGz: Buffer | null) {
  if (descriptionGz === null) {
    return "";
  }

  const text = gunzipSync(descriptionGz).toString("utf8");

  return text.split(/\s+/u).slice(0, DESCRIPTION_WORDS).join(" ");
}

export function fallbackCacheKey(companyId: string, title: string, department: string | null) {
  const parts = [companyId, normalizeTitle(title)];

  if (department !== null) {
    parts.push(normalizeTitle(department));
  }

  return parts.join("|");
}

/**
 * The untagged Postings, filtered in SQL. `isNull(postingTags.value)` keeps every Posting that already carries a
 * role tag out of the result set, so the scan never reads a tagged row's description, and the SQL `LIMIT` bounds how
 * many rows a single run materializes.
 * @param db The catalog database.
 * @returns The leftover Postings, without their descriptions.
 */
function selectLeftovers(db: CatalogDatabase) {
  return db
    .select({
      id: postings.id,
      companyId: postings.companyId,
      companyName: companies.name,
      title: postings.title,
      department: postings.department,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .leftJoin(
      postingTags,
      and(
        eq(postingTags.postingId, postings.id),
        eq(postingTags.dimension, "role"),
        inArray(postingTags.source, ["rules", "model", "llm"]),
      ),
    )
    .where(
      and(
        isNull(postings.closedAt),
        isNull(postingTags.value),
        or(isNull(postings.tagSource), inArray(postings.tagSource, ["rules", "model", "llm"])),
      ),
    )
    .limit(LEFTOVER_SCAN_LIMIT)
    .all()
    .map((row) => ({
      id: row.id,
      companyId: row.companyId,
      cacheKey: fallbackCacheKey(row.companyId, row.title, row.department),
      companyName: row.companyName,
      title: row.title,
      department: row.department,
    }));
}

function companyIdsOf(leftovers: readonly LeftoverPosting[]) {
  return [...new Set(leftovers.map((posting) => posting.companyId))];
}

/**
 * The LLM tags already recorded for the companies this run is about, keyed so a repeated title can reuse them. The
 * lookup is scoped: a catalog-wide read of every `llm` tag cost memory proportional to the whole catalog on boot.
 * @param db The catalog database.
 * @param companyIds The companies the selected leftovers belong to.
 * @returns The recorded tags by cache key; empty when there is nothing to tag.
 */
function cachedTagsByCacheKey(db: CatalogDatabase, companyIds: readonly string[]) {
  const byCacheKey = new Map<string, CachedTag[]>();

  if (companyIds.length === 0) {
    return byCacheKey;
  }

  const rows = db
    .select({
      companyId: postings.companyId,
      title: postings.title,
      department: postings.department,
      dimension: postingTags.dimension,
      value: postingTags.value,
    })
    .from(postingTags)
    .innerJoin(postings, eq(postings.id, postingTags.postingId))
    .where(
      and(
        eq(postingTags.source, "llm"),
        inArray(postingTags.dimension, ["role", "subrole"]),
        inArray(postings.companyId, [...companyIds]),
      ),
    )
    .all();

  for (const row of rows) {
    if (row.dimension !== "role" && row.dimension !== "subrole") {
      continue;
    }

    const cacheKey = fallbackCacheKey(row.companyId, row.title, row.department);
    const entry = byCacheKey.get(cacheKey) ?? [];

    entry.push({ dimension: row.dimension, value: row.value });
    byCacheKey.set(cacheKey, entry);
  }

  return byCacheKey;
}

/**
 * Reads the compressed descriptions of the given Postings only. It runs right before the requests are built, for the
 * batch's representative ids, so an idle or already-tagged catalog never loads a description at all.
 * @param db The catalog database.
 * @param postingIds The representative Postings of the batch.
 * @returns The gzipped descriptions by posting id.
 */
function descriptionsById(db: CatalogDatabase, postingIds: readonly string[]) {
  const byId = new Map<string, Buffer | null>();

  if (postingIds.length === 0) {
    return byId;
  }

  const rows = db
    .select({ id: postings.id, descriptionGz: postings.descriptionGz })
    .from(postings)
    .where(inArray(postings.id, [...postingIds]))
    .all();

  for (const row of rows) {
    byId.set(row.id, row.descriptionGz ?? null);
  }

  return byId;
}

/**
 * Builds one request per group, yielding the event loop periodically so the synchronous gunzip of a large batch never
 * holds the thread for the whole run.
 * @param groups The batch's groups.
 * @param descriptions The gzipped descriptions of the batch's representatives.
 * @returns The requests to send.
 */
async function buildRequests(
  groups: readonly LeftoverGroup[],
  descriptions: ReadonlyMap<string, Buffer | null>,
) {
  const requests: LlmRequest[] = [];

  for (const [index, group] of groups.entries()) {
    if (index > 0 && index % YIELD_EVERY === 0) {
      await yieldToEventLoop();
    }

    requests.push({
      purpose: TAG_FALLBACK_PURPOSE,
      customId: `tag-fallback-${String(index)}`,
      system: SYSTEM_PROMPT,
      user: [
        `company: ${group.representative.companyName}`,
        `title: ${group.representative.title}`,
        `department: ${group.representative.department ?? "none"}`,
        `description: ${descriptionWordsFor(descriptions.get(group.representative.id) ?? null)}`,
      ].join("\n"),
      schema: OUTPUT_SCHEMA,
    });
  }

  return requests;
}

function groupLeftovers(leftovers: readonly LeftoverPosting[]) {
  const groupsByCacheKey = new Map<string, LeftoverGroup>();

  for (const posting of leftovers) {
    const group = groupsByCacheKey.get(posting.cacheKey);

    if (group === undefined) {
      groupsByCacheKey.set(posting.cacheKey, {
        cacheKey: posting.cacheKey,
        representative: posting,
        postingIds: [posting.id],
      });

      continue;
    }

    group.postingIds.push(posting.id);
  }

  return [...groupsByCacheKey.values()];
}

function queueNextRun(db: AppDatabase, clock: Clock, runAt: number) {
  const hasQueued = db
    .select({ one: bgJobs.id })
    .from(bgJobs)
    .where(and(eq(bgJobs.kind, TAG_FALLBACK_JOB_KIND), eq(bgJobs.status, "queued")))
    .limit(1)
    .get();

  if (hasQueued === undefined) {
    enqueueJob(db, clock, TAG_FALLBACK_JOB_KIND, "{}", { runAt });
  }
}

export function ensureTagFallbackQueued(db: AppDatabase, clock: Clock) {
  const existing = db
    .select({ one: bgJobs.id })
    .from(bgJobs)
    .where(
      and(eq(bgJobs.kind, TAG_FALLBACK_JOB_KIND), inArray(bgJobs.status, ["queued", "running"])),
    )
    .limit(1)
    .get();

  if (existing !== undefined) {
    return false;
  }

  enqueueJob(db, clock, TAG_FALLBACK_JOB_KIND, "{}", { runAt: nextUtcMidnight(clock.now()) });

  return true;
}

export async function runTagFallbackJob(deps: TagFallbackDeps) {
  const report: TagFallbackReport = {
    leftovers: 0,
    reused: 0,
    sent: 0,
    tagged: 0,
    recorded: 0,
    blocked: false,
    blockedCap: null,
  };

  const leftovers = selectLeftovers(deps.catalogDb);

  report.leftovers = leftovers.length;

  const groups = groupLeftovers(leftovers);
  const cached = cachedTagsByCacheKey(deps.catalogDb, companyIdsOf(leftovers));
  const now = deps.clock.now();

  for (const group of groups) {
    const cacheHits = cached.get(group.cacheKey);

    if (cacheHits === undefined) {
      continue;
    }

    const writes: TagWrite[] = [];

    for (const hit of cacheHits) {
      writes.push({ dimension: hit.dimension, value: hit.value, source: LLM_TAG_SOURCE });
    }

    for (const postingId of group.postingIds) {
      writePostingTags(deps.catalogDb, postingId, writes, now);

      report.reused += 1;
      report.tagged += 1;
    }
  }

  const uncached = groups.filter((group) => cached.get(group.cacheKey) === undefined);
  const batch = uncached.slice(0, MAX_BATCH_ITEMS);

  if (batch.length > 0) {
    const descriptions = descriptionsById(
      deps.catalogDb,
      batch.map((group) => group.representative.id),
    );

    const requests = await buildRequests(batch, descriptions);
    const estimated = deps.llm.estimateBatchCostMicros(requests);

    const caps = checkLlmCaps(deps.db, deps.clock, {
      userId: null,
      purpose: TAG_FALLBACK_PURPOSE,
      estimatedCostMicros: estimated,
    });

    if (caps.withinCaps) {
      report.sent = requests.length;

      const calls = await deps.llm.runBatch(requests);

      const outcomeByCustomId = new Map<string, BatchOutcome>();

      for (const call of calls) {
        recordLlmUsage(deps.db, deps.clock, {
          batch:
            call.batchRecordId === undefined
              ? undefined
              : { customId: call.customId, recordId: call.batchRecordId },
          userId: null,
          purpose: TAG_FALLBACK_PURPOSE,
          model: call.model,
          inputTokens: call.inputTokens,
          cachedTokens: call.cachedTokens,
          outputTokens: call.outputTokens,
          costMicros: call.costMicros,
        });

        report.recorded += 1;

        const parsed = batchOutputSchema.safeParse(call.result.ok ? call.result.value : null);

        if (parsed.success) {
          outcomeByCustomId.set(call.customId, parsed.data);
        }
      }

      for (const [index, group] of batch.entries()) {
        const outcome = outcomeByCustomId.get(`tag-fallback-${String(index)}`);

        if (outcome !== undefined && outcome.role !== null) {
          const writes: TagWrite[] = [
            { dimension: "role", value: outcome.role, source: LLM_TAG_SOURCE },
          ];

          if (outcome.subrole !== null) {
            writes.push({ dimension: "subrole", value: outcome.subrole, source: LLM_TAG_SOURCE });
          }

          for (const postingId of group.postingIds) {
            writePostingTags(deps.catalogDb, postingId, writes, now);

            report.tagged += 1;
          }
        }
      }
    } else {
      let postingsWaiting = 0;

      for (const group of uncached) {
        postingsWaiting += group.postingIds.length;
      }

      report.blocked = true;
      report.blockedCap = caps.exceeded;

      raiseAlert(deps.db, deps.clock, "llm.cap", {
        cap: caps.exceeded,
        purpose: TAG_FALLBACK_PURPOSE,
        spentMicros: caps.spentMicros,
        estimatedMicros: estimated,
        capMicros: caps.capMicros,
        postingsWaiting,
      });
    }
  }

  // A run that tagged nothing (the model answered outside the taxonomy, or every call failed) must not queue itself a
  // minute later and spend again: it waits for tomorrow's run instead.
  const hasMore =
    !report.blocked &&
    report.tagged > 0 &&
    (leftovers.length >= LEFTOVER_SCAN_LIMIT || uncached.length > batch.length);

  queueNextRun(
    deps.db,
    deps.clock,
    hasMore ? deps.clock.now() + CONTINUE_DELAY_MS : nextUtcMidnight(deps.clock.now()),
  );

  return report;
}
