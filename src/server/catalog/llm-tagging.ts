import { gunzipSync } from "node:zlib";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmOutputSchema, LlmPort, LlmRequest } from "../platform/ports/llm.ts";
import { bgJobs } from "../platform/db/schema.ts";
import { companies, postings, postingTags } from "../platform/db/catalog-schema.ts";
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
const MAX_BATCH_ITEMS = 10_000;
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

interface LeftoverPosting {
  id: string;
  cacheKey: string;
  companyName: string;
  title: string;
  department: string | null;
  descriptionGz: Buffer | null;
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

function selectLeftovers(db: CatalogDatabase) {
  return db
    .select({
      id: postings.id,
      companyId: postings.companyId,
      companyName: companies.name,
      title: postings.title,
      department: postings.department,
      descriptionGz: postings.descriptionGz,
      roleTag: postingTags.value,
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
        or(isNull(postings.tagSource), inArray(postings.tagSource, ["rules", "model", "llm"])),
      ),
    )
    .all()
    .filter((row) => row.roleTag === null)
    .map((row) => ({
      id: row.id,
      cacheKey: fallbackCacheKey(row.companyId, row.title, row.department),
      companyName: row.companyName,
      title: row.title,
      department: row.department,
      descriptionGz: row.descriptionGz ?? null,
    }));
}

function cachedTagsByCacheKey(db: CatalogDatabase) {
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
    .where(and(eq(postingTags.source, "llm"), inArray(postingTags.dimension, ["role", "subrole"])))
    .all();

  const bycacheKey = new Map<string, CachedTag[]>();

  for (const row of rows) {
    if (row.dimension !== "role" && row.dimension !== "subrole") {
      continue;
    }

    const cacheKey = fallbackCacheKey(row.companyId, row.title, row.department);
    const entry = bycacheKey.get(cacheKey) ?? [];

    entry.push({ dimension: row.dimension, value: row.value });
    bycacheKey.set(cacheKey, entry);
  }

  return bycacheKey;
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

  const cached = cachedTagsByCacheKey(deps.catalogDb);
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

  const groups = [...groupsByCacheKey.values()];
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

  if (uncached.length > 0) {
    const requests: LlmRequest[] = uncached.slice(0, MAX_BATCH_ITEMS).map((group, index) => ({
      purpose: TAG_FALLBACK_PURPOSE,
      customId: `tag-fallback-${String(index)}`,
      system: SYSTEM_PROMPT,
      user: [
        `company: ${group.representative.companyName}`,
        `title: ${group.representative.title}`,
        `department: ${group.representative.department ?? "none"}`,
        `description: ${descriptionWordsFor(group.representative.descriptionGz)}`,
      ].join("\n"),
      schema: OUTPUT_SCHEMA,
    }));

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

      for (const [index, group] of uncached.entries()) {
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

  const hasQueued = deps.db
    .select({ one: bgJobs.id })
    .from(bgJobs)
    .where(and(eq(bgJobs.kind, TAG_FALLBACK_JOB_KIND), eq(bgJobs.status, "queued")))
    .limit(1)
    .get();

  if (hasQueued === undefined) {
    enqueueJob(deps.db, deps.clock, TAG_FALLBACK_JOB_KIND, "{}", {
      runAt: nextUtcMidnight(deps.clock.now()),
    });
  }

  return report;
}
