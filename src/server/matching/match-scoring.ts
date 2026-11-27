import { and, count, eq, gte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort, LlmRequest, LlmStructuredRequest } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { TargetsInput } from "../../shared/targets.ts";

import { matches, profiles, resumes, users } from "../platform/db/schema.ts";
import { isPaidUser } from "../jobs/preferences.ts";
import { checkLlmCaps } from "../platform/llm/caps.ts";
import { recordLlmSchemaRejection } from "../platform/llm/schema-rejections.ts";
import { recordLlmUsage } from "../platform/llm/usage.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { ungatedSpend } from "../billing/spend.ts";
import type { SpendGate } from "../billing/spend.ts";
import { createLanguagesService } from "../profile/languages.ts";
import { createTargetsService } from "../profile/targets.ts";
import { targetsLine } from "./judge-input.ts";
import { createJobsPool } from "./jobs-pool.ts";
import type { RankedJob } from "./jobs-pool.ts";
import { matchBandOf, matchPage, topPicksByEmployer } from "./match-sort.ts";
import {
  dropMatchesNotIn,
  matchIsReusable,
  readStoredMatches,
  writePendingMatch,
  writeScoredMatch,
} from "./match-store.ts";
import type { ScoreIdentity } from "./match-store.ts";
import { SCORE_SCORER_VERSION, scoreRequestFor } from "./prompts/score-v1.ts";
import { parseScoreReply } from "./score-schema.ts";
import type { ScoreReply } from "./score-schema.ts";

export const MATCH_SCORE_PURPOSE = "score";
export const ONBOARDING_SCORE_LIMIT = 1000;
export const DAILY_NEW_JOB_LIMIT = 50;
export const RESCORE_LIVE_LIMIT = 100;
export const ONBOARDING_TOP_LIMIT = 3;

const DAY_MS = 86_400_000;
const DESCRIPTION_WORDS = 220;
const LIVE_CONCURRENCY = 4;

interface MatchScoringDeps {
  db: AppDatabase;
  clock: Clock;
  llm: LlmPort;
  personal: PersonalCrypto;
  spendGate?: SpendGate | undefined;
}

interface ScoreCandidate {
  resumeId: string | null;
  resumeText: string;
  targets: TargetsInput;
  targetsVersion: number;
  targetsLine: string;
  languages: readonly string[];
}

export interface ScoreRunResult {
  candidates: number;
  scored: number;
  rejected: number;
  skippedForBudget: boolean;
}

function jobDescription(description: string | null) {
  if (description === null || description.trim() === "") {
    return "No description was provided.";
  }

  return description.split(/\s+/u).slice(0, DESCRIPTION_WORDS).join(" ");
}

function companyKeyOf(job: Pick<RankedJob, "companySlug" | "company">) {
  return (job.companySlug ?? job.company).trim().toLowerCase();
}

function structuredFrom(request: LlmRequest) {
  return {
    cachePrefix: request.cachePrefix,
    purpose: request.purpose,
    schema: request.schema,
    system: request.system,
    user: request.user,
  };
}

function startOfUtcDay(at: number) {
  return Math.floor(at / DAY_MS) * DAY_MS;
}

function identityOf(candidate: ScoreCandidate, job: RankedJob) {
  return {
    descriptionHash: job.descriptionHash,
    resumeId: candidate.resumeId,
    scorerVersion: SCORE_SCORER_VERSION,
    targetsVersion: candidate.targetsVersion,
  } satisfies ScoreIdentity;
}

function batchCustomId(index: number) {
  return `score-${String(index)}`;
}

function requestFor(candidate: ScoreCandidate, job: RankedJob, customId: string) {
  return scoreRequestFor({
    candidate: { resume: candidate.resumeText, targets: candidate.targetsLine },
    customId,
    job: {
      company: job.company,
      description: jobDescription(job.description),
      location: job.locationRaw ?? "unknown",
      title: job.title,
    },
  });
}

/**
 * Scores the freehire pool with Claude Haiku 5.5: live one job per call where a person waits, the Message Batches API
 * where nobody does. Every reply is validated by zod, invalid replies get one retry and are then rejected, and a score
 * is stored once against the resume, targets and scorer versions that produced it.
 * @param deps The database, clock, model port, personal crypto and spend gate.
 * @returns The scoring service the routes and background jobs share.
 */
export function createMatchScoringService(deps: MatchScoringDeps) {
  const { db, clock, llm, personal, spendGate = ungatedSpend } = deps;

  const pool = createJobsPool({ clock, db });
  const targetsService = createTargetsService({ clock, db });
  const languagesService = createLanguagesService({ clock, db });

  async function candidateFor(userId: string) {
    const resume = db
      .select()
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isCurrent, true)))
      .get();

    const resumeText =
      resume === undefined
        ? ""
        : await personal.openFor(
            userId,
            { column: "text_enc", rowId: resume.id, table: "resumes" },
            resume.textEnc,
          );

    const saved = await targetsService.read(userId);
    const { languages } = await languagesService.read(userId);

    return {
      languages,
      resumeId: resume?.id ?? null,
      resumeText: resumeText.trim().slice(0, 12_000),
      targets: saved.targets,
      targetsLine: targetsLine(saved.targets),
      targetsVersion: saved.version,
    };
  }

  function onboardingMatchingFor(userId: string) {
    const account = db
      .select({
        onboardedAt: profiles.onboardedAt,
        role: users.role,
        running: profiles.running,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, userId))
      .get();

    return (
      account?.onboardedAt === null &&
      account.role !== "owner" &&
      account.role !== "demo" &&
      !account.running
    );
  }

  function capCheck(userId: string, estimatedCostMicros: number) {
    return checkLlmCaps(db, clock, {
      estimatedCostMicros,
      onboardingMatching: onboardingMatchingFor(userId),
      purpose: MATCH_SCORE_PURPOSE,
      userId,
    });
  }

  function noteCap(caps: ReturnType<typeof capCheck>, waiting: number) {
    raiseAlert(db, clock, "llm.cap", {
      cap: caps.exceeded,
      capMicros: caps.capMicros,
      postingsWaiting: waiting,
      purpose: MATCH_SCORE_PURPOSE,
      spentMicros: caps.spentMicros,
    });
  }

  function recordCall(
    userId: string,
    call: {
      model: string;
      inputTokens: number;
      cachedTokens: number;
      outputTokens: number;
      costMicros: number;
    },
  ) {
    recordLlmUsage(db, clock, {
      costMicros: call.costMicros,
      cachedTokens: call.cachedTokens,
      inputTokens: call.inputTokens,
      model: call.model,
      outputTokens: call.outputTokens,
      purpose: MATCH_SCORE_PURPOSE,
      userId,
    });
  }

  async function askOnce(userId: string, request: LlmStructuredRequest) {
    const caps = capCheck(userId, llm.estimateStructuredCostMicros(request));

    if (!caps.withinCaps) {
      return { budget: false as const, reply: null };
    }

    const call = await llm.runStructured(request).catch(() => null);

    if (call === null) {
      return { budget: true as const, reply: null };
    }

    recordCall(userId, call);

    return { budget: true as const, reply: parseScoreReply(call.text) };
  }

  function storePending(userId: string, job: RankedJob, codeRank: number, identity: ScoreIdentity) {
    writePendingMatch(db, {
      codeRank,
      companyKey: companyKeyOf(job),
      descriptionHash: identity.descriptionHash,
      exactRole: job.exactRole,
      jobId: job.id,
      postedAt: job.postedAt,
      userId,
    });
  }

  function storeScore(
    userId: string,
    job: RankedJob,
    codeRank: number,
    identity: ScoreIdentity,
    reply: ScoreReply,
  ) {
    writeScoredMatch(db, clock, {
      codeRank,
      companyKey: companyKeyOf(job),
      exactRole: job.exactRole,
      identity,
      jobId: job.id,
      postedAt: job.postedAt,
      reply,
      userId,
    });
  }

  async function scoreLiveJob(
    userId: string,
    candidate: ScoreCandidate,
    job: RankedJob,
    codeRank: number,
  ) {
    const request = structuredFrom(requestFor(candidate, job, "score-live"));
    const first = await askOnce(userId, request);

    if (!first.budget) {
      return { outcome: "budget" as const };
    }

    const reply = first.reply ?? (await askOnce(userId, request)).reply;

    if (reply === null) {
      recordLlmSchemaRejection(db, clock, {
        model: SCORE_SCORER_VERSION,
        purpose: MATCH_SCORE_PURPOSE,
      });

      return { outcome: "rejected" as const };
    }

    storeScore(userId, job, codeRank, identityOf(candidate, job), reply);

    return { outcome: "scored" as const };
  }

  async function scoreLive(
    userId: string,
    candidate: ScoreCandidate,
    jobs: readonly RankedJob[],
    start = 0,
    previous?: { scored: number; rejected: number; skippedForBudget: boolean },
  ) {
    const result = previous ?? { rejected: 0, scored: 0, skippedForBudget: false };
    const batch = jobs.slice(start, start + LIVE_CONCURRENCY);

    if (batch.length === 0) {
      return result;
    }

    const outcomes = await Promise.all(
      batch.map(async (job, index) =>
        scoreLiveJob(userId, candidate, job, jobs.length - start - index),
      ),
    );

    for (const outcome of outcomes) {
      if (outcome.outcome === "scored") {
        result.scored += 1;
      } else if (outcome.outcome === "rejected") {
        result.rejected += 1;
      } else {
        result.skippedForBudget = true;
      }
    }

    if (result.skippedForBudget) {
      return result;
    }

    return scoreLive(userId, candidate, jobs, start + batch.length, result);
  }

  function affordable(requests: readonly LlmRequest[], userId: string, waiting: number) {
    const caps = capCheck(userId, llm.estimateBatchCostMicros(requests));

    if (caps.withinCaps) {
      return requests;
    }

    noteCap(caps, waiting);

    const perRequest = llm.estimateBatchCostMicros(requests.slice(0, 1));
    const remaining = Math.max(0, caps.capMicros - caps.spentMicros);
    const allowed = perRequest === 0 ? requests.length : Math.floor(remaining / perRequest);

    return requests.slice(0, Math.max(0, allowed));
  }

  async function scoreBatch(
    userId: string,
    candidate: ScoreCandidate,
    jobs: readonly RankedJob[],
    start: number,
    result: { scored: number; rejected: number },
    attempt = 0,
  ) {
    const chunk = jobs.slice(start, start + 100);

    if (chunk.length === 0) {
      return result;
    }

    const requests = affordable(
      chunk.map((job, index) => requestFor(candidate, job, batchCustomId(index))),
      userId,
      jobs.length - start,
    );

    if (requests.length === 0) {
      return result;
    }

    const byCustomId = new Map(chunk.map((job, index) => [batchCustomId(index), job]));
    const calls = await llm.runBatch(requests);
    const invalid: RankedJob[] = [];

    for (const call of calls) {
      recordCall(userId, call);

      const job = byCustomId.get(call.customId);

      if (job === undefined) {
        continue;
      }

      const parsed = call.result.ok ? parseScoreReply(JSON.stringify(call.result.value)) : null;

      if (parsed === null) {
        if (attempt === 0) {
          invalid.push(job);
        } else {
          recordLlmSchemaRejection(db, clock, {
            model: SCORE_SCORER_VERSION,
            purpose: MATCH_SCORE_PURPOSE,
          });
          result.rejected += 1;
        }

        continue;
      }

      storeScore(userId, job, 0, identityOf(candidate, job), parsed);
      result.scored += 1;
    }

    if (invalid.length > 0) {
      await scoreBatch(userId, candidate, invalid, 0, result, 1);
    }

    return scoreBatch(userId, candidate, jobs, start + chunk.length, result, attempt);
  }

  async function run(
    userId: string,
    mode: "live" | "batch",
    limit: number,
    options: { dailyCap?: boolean; paidOnly?: boolean } = {},
  ) {
    if (!spendGate.allowsOnboarding(userId)) {
      return { candidates: 0, rejected: 0, scored: 0, skippedForBudget: true };
    }

    if (options.paidOnly === true && !isPaidUser(db, userId, clock.now())) {
      return { candidates: 0, rejected: 0, scored: 0, skippedForBudget: false };
    }

    const candidate = await candidateFor(userId);
    const { jobs } = pool.read(userId, candidate.targets, candidate.languages);
    const stored = new Map(readStoredMatches(db, userId).map((row) => [row.id, row]));

    const fresh = jobs.filter((job) => {
      const row = stored.get(job.id);

      return row === undefined || !matchIsReusable(row, identityOf(candidate, job));
    });

    for (const [index, job] of fresh.slice(0, limit).entries()) {
      storePending(userId, job, jobs.length - index, identityOf(candidate, job));
    }

    const toScore = fresh.slice(0, limit);

    if (toScore.length === 0) {
      return { candidates: jobs.length, rejected: 0, scored: 0, skippedForBudget: false };
    }

    if (mode === "batch") {
      const today =
        db
          .select({ total: count() })
          .from(matches)
          .where(and(eq(matches.userId, userId), gte(matches.scoredAt, startOfUtcDay(clock.now()))))
          .get()?.total ?? 0;

      const remaining =
        options.dailyCap === false ? toScore.length : Math.max(0, DAILY_NEW_JOB_LIMIT - today);

      const batched = toScore.slice(0, remaining);
      const result = await scoreBatch(userId, candidate, batched, 0, { rejected: 0, scored: 0 });

      return { candidates: jobs.length, ...result, skippedForBudget: false };
    }

    const live = await scoreLive(userId, candidate, toScore);

    return {
      candidates: jobs.length,
      rejected: live.rejected,
      scored: live.scored,
      skippedForBudget: live.skippedForBudget,
    };
  }

  async function scorePool(userId: string) {
    return run(userId, "live", ONBOARDING_SCORE_LIMIT);
  }

  async function scoreNewJobs(userId: string) {
    return run(userId, "batch", DAILY_NEW_JOB_LIMIT, { dailyCap: true, paidOnly: true });
  }

  async function rescore(userId: string) {
    const live = await run(userId, "live", RESCORE_LIVE_LIMIT);
    const rest = await run(userId, "batch", ONBOARDING_SCORE_LIMIT, { dailyCap: false });

    return {
      candidates: live.candidates,
      rejected: live.rejected + rest.rejected,
      scored: live.scored + rest.scored,
      skippedForBudget: live.skippedForBudget || rest.skippedForBudget,
    } satisfies ScoreRunResult;
  }

  async function rescoreJob(userId: string, jobId: string) {
    const candidate = await candidateFor(userId);
    const { jobs } = pool.read(userId, candidate.targets, candidate.languages);
    const job = jobs.find((row) => row.id === jobId);

    if (job === undefined) {
      return false;
    }

    const result = await scoreLiveJob(userId, candidate, job, 0);

    return result.outcome === "scored";
  }

  function page(userId: string, offset: number, limit: number) {
    const rows = readStoredMatches(db, userId);
    const result = matchPage(rows, offset, limit);

    return {
      items: result.items.map((row) => ({
        band: row.score === null ? null : matchBandOf(row.score),
        id: row.id,
        score: row.score,
      })),
      total: result.total,
    };
  }

  async function topPicks(userId: string, limit: number) {
    const candidate = await candidateFor(userId);
    const { jobs } = pool.read(userId, candidate.targets, candidate.languages);
    const stored = new Map(readStoredMatches(db, userId).map((row) => [row.id, row]));

    const unscored = jobs.filter((job) => {
      const row = stored.get(job.id);

      return row === undefined || !matchIsReusable(row, identityOf(candidate, job));
    });

    const needed = limit * 4;

    if (unscored.length > 0) {
      for (const [index, job] of unscored.slice(0, needed).entries()) {
        storePending(userId, job, jobs.length - index, identityOf(candidate, job));
      }

      await scoreLive(userId, candidate, unscored.slice(0, needed));
    }

    const jobIds = new Set(jobs.map((job) => job.id));
    const rows = readStoredMatches(db, userId).filter((row) => jobIds.has(row.id));

    return topPicksByEmployer(rows, limit);
  }

  async function pruneRemoved(userId: string) {
    const candidate = await candidateFor(userId);
    const { jobs } = pool.read(userId, candidate.targets, candidate.languages);

    return dropMatchesNotIn(
      db,
      userId,
      jobs.map((job) => job.id),
    );
  }

  return { page, pruneRemoved, rescore, rescoreJob, scoreNewJobs, scorePool, topPicks };
}

export type MatchScoringService = ReturnType<typeof createMatchScoringService>;

export type { StoredMatch } from "./match-store.ts";
