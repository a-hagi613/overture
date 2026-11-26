import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmOutputSchema, LlmPort, LlmRequest } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { RankedCandidate } from "./candidates.ts";
import type { Targets } from "../../shared/targets.ts";

import { applications, matches, postingUserState, resumes } from "../platform/db/schema.ts";
import { companies, postingTags, postings } from "../platform/db/catalog-schema.ts";

import { applicationsLeft } from "../billing/ledger.ts";
import type { SpendGate } from "../billing/spend.ts";
import { ungatedSpend } from "../billing/spend.ts";
import { checkLlmCaps } from "../platform/llm/caps.ts";
import { recordLlmUsage } from "../platform/llm/usage.ts";
import { recordLlmSchemaRejection } from "../platform/llm/schema-rejections.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { enqueueApplicationPrepare } from "../pipeline/prepare-jobs.ts";
import { getSettingNumber } from "../platform/settings/index.ts";
import { createLanguagesService } from "../profile/languages.ts";
import { createTargetsService } from "../profile/targets.ts";
import { activeApplicationCompanies, applicationFor, createApplication } from "./applications.ts";
import { createCandidateService } from "./candidates.ts";
import { descriptionSummary, postingRoleName, scoreTagsLine, targetsLine } from "./judge-input.ts";

export const SCORE_PURPOSE = "score";

const WAITING_STATUSES = ["preparing", "ready", "approved"] as const;

const CHUNK_SIZE = 5;
const SCORE_ATTEMPT_MULTIPLE = 3;
const RESUME_DIGEST_CHARS = 1500;

const OUTPUT_SCHEMA: LlmOutputSchema = {
  type: "object",
  properties: {
    score: { type: "number", description: "Fit from 0 to 100." },
    reason: { type: "string", description: "One line, 140 characters or fewer." },
  },
  required: ["score", "reason"],
  additionalProperties: false,
};

const scoreOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string().min(1),
});

const SYSTEM_PROMPT = [
  "You score how well a job posting fits one candidate's resume and targets.",
  "Give 0-100 for overall fit. Be strict: 80 or above only for a strong fit on role, seniority, place and pay.",
  "Write one line of at most 140 characters saying why, naming the strongest match or the gap.",
  "Use only the facts given. Never invent experience.",
  "Return the JSON the tool requests, with no other text.",
].join(" ");

type ScoreOutput = z.infer<typeof scoreOutputSchema>;

interface MatchDeps {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  llm: LlmPort;
  personal: PersonalCrypto;
  /** Paid scoring never runs without Applications left when gated. */
  spendGate?: SpendGate | undefined;
}

interface ScoreContext {
  resumeId: string | null;
  resumeDigest: string;
  targetsVersion: number;
  targetsLine: string;
  threshold: number;
}

function truncateReason(reason: string) {
  return reason.trim().slice(0, 140);
}

const SALARY_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function whyBullets(candidate: RankedCandidate, targets: Targets) {
  const bullets: string[] = [];
  const role = postingRoleName(candidate.tags);
  const seniority = candidate.tags.find((tag) => tag.dimension === "seniority")?.value;

  if (role !== null) {
    bullets.push(`Matches your ${role} target`);
  }

  if (seniority !== undefined && targets.seniorities.some((target) => target === seniority)) {
    bullets.push(`${titleCase(seniority)} level, as you asked`);
  }

  if (candidate.workplace === "remote") {
    bullets.push("Remote");
  } else if (candidate.locationRaw !== null) {
    bullets.push(`In ${candidate.locationRaw}`);
  }

  if (candidate.salaryMinMinor !== null && candidate.salaryCurrency !== null) {
    bullets.push(
      `Pays from ${candidate.salaryCurrency} ${SALARY_FORMAT.format(Math.round(candidate.salaryMinMinor / 100))}`,
    );
  }

  return bullets.slice(0, 3);
}

function scoreRequest(input: {
  customId: string;
  title: string;
  company: string;
  location: string;
  workplace: string;
  employmentType: string;
  salary: string;
  tags: string;
  summary: string;
  targets: string;
  resumeDigest: string;
}) {
  const user = [
    `title: ${input.title}`,
    `company: ${input.company}`,
    `location: ${input.location}`,
    `workplace: ${input.workplace}`,
    `employment: ${input.employmentType}`,
    `salary: ${input.salary}`,
    `tags: ${input.tags}`,
    `summary: ${input.summary}`,
    `targets: ${input.targets}`,
    `resume: ${input.resumeDigest}`,
  ].join("\n");

  return {
    customId: input.customId,
    purpose: SCORE_PURPOSE,
    schema: OUTPUT_SCHEMA,
    system: SYSTEM_PROMPT,
    user,
  } satisfies LlmRequest;
}

export function createMatchingService(deps: MatchDeps) {
  const { db, catalogDb, clock, llm, personal, spendGate = ungatedSpend } = deps;

  const candidates = createCandidateService({ db, catalogDb, clock, personal });
  const languagesService = createLanguagesService({ db, clock });
  const targetsService = createTargetsService({ db, clock });

  async function contextFor(userId: string) {
    const resume = db
      .select()
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isCurrent, true)))
      .get();

    const resumeDigest =
      resume === undefined
        ? ""
        : (
            await personal.openFor(
              userId,
              { table: "resumes", column: "text_enc", rowId: resume.id },
              resume.textEnc,
            )
          ).slice(0, RESUME_DIGEST_CHARS);

    const targets = await targetsService.read(userId);

    return {
      resumeDigest,
      resumeId: resume?.id ?? null,
      targetsVersion: targets.version,
      targetsLine: targetsLine(targets.targets),
      threshold: getSettingNumber(db, "match.auto_threshold_default"),
    };
  }

  function descriptionsFor(postingIds: readonly string[]) {
    const rows = catalogDb
      .select({ id: postings.id, descriptionGz: postings.descriptionGz })
      .from(postings)
      .where(inArray(postings.id, [...postingIds]))
      .all();

    return new Map(rows.map((row) => [row.id, row.descriptionGz]));
  }

  function cachedMatch(userId: string, postingId: string, context: ScoreContext) {
    const row = db
      .select()
      .from(matches)
      .where(and(eq(matches.userId, userId), eq(matches.postingId, postingId)))
      .get();

    if (
      row?.score === undefined ||
      row.score === null ||
      row.resumeId !== context.resumeId ||
      row.targetsVersion !== context.targetsVersion
    ) {
      return null;
    }

    return { score: row.score, reason: row.reason ?? "" };
  }

  function writeMatch(
    userId: string,
    postingId: string,
    codeRank: number,
    output: ScoreOutput | null,
    context: ScoreContext,
  ) {
    const at = clock.now();

    if (output === null) {
      db.insert(matches)
        .values({ userId, postingId, codeRank })
        .onConflictDoUpdate({
          target: [matches.userId, matches.postingId],
          set: { codeRank },
        })
        .run();

      return;
    }

    db.insert(matches)
      .values({
        userId,
        postingId,
        codeRank,
        score: output.score,
        reason: truncateReason(output.reason),
        resumeId: context.resumeId,
        targetsVersion: context.targetsVersion,
        scoredAt: at,
      })
      .onConflictDoUpdate({
        target: [matches.userId, matches.postingId],
        set: {
          codeRank,
          score: output.score,
          reason: truncateReason(output.reason),
          resumeId: context.resumeId,
          targetsVersion: context.targetsVersion,
          scoredAt: at,
        },
      })
      .run();
  }

  async function runScoreRequests(userId: string, requests: LlmRequest[]) {
    const scores = new Map<string, ScoreOutput>();

    if (requests.length === 0 || !spendGate.allows(userId)) {
      return scores;
    }

    const estimated = llm.estimateBatchCostMicros(requests);

    const caps = checkLlmCaps(db, clock, {
      userId,
      purpose: SCORE_PURPOSE,
      estimatedCostMicros: estimated,
    });

    if (!caps.withinCaps) {
      raiseAlert(db, clock, "llm.cap", {
        cap: caps.exceeded,
        purpose: SCORE_PURPOSE,
        spentMicros: caps.spentMicros,
        estimatedMicros: estimated,
        capMicros: caps.capMicros,
        postingsWaiting: requests.length,
      });

      return scores;
    }

    const calls = await llm.runBatch(requests);

    for (const call of calls) {
      recordLlmUsage(db, clock, {
        batch:
          call.batchRecordId === undefined
            ? undefined
            : { customId: call.customId, recordId: call.batchRecordId },
        userId,
        purpose: SCORE_PURPOSE,
        model: call.model,
        inputTokens: call.inputTokens,
        cachedTokens: call.cachedTokens,
        outputTokens: call.outputTokens,
        costMicros: call.costMicros,
      });

      const parsed = scoreOutputSchema.safeParse(call.result.ok ? call.result.value : null);

      if (parsed.success) {
        scores.set(call.customId, parsed.data);
      } else {
        recordLlmSchemaRejection(db, clock, { model: call.model, purpose: SCORE_PURPOSE });
      }
    }

    return scores;
  }

  async function scorePosting(userId: string, postingId: string) {
    const row = catalogDb
      .select({
        id: postings.id,
        companyId: postings.companyId,
        companyName: companies.name,
        title: postings.title,
        locationRaw: postings.locationRaw,
        workplace: postings.workplace,
        employmentType: postings.employmentType,
        salaryMinMinor: postings.salaryMinMinor,
        salaryCurrency: postings.salaryCurrency,
        salaryPeriod: postings.salaryPeriod,
        descriptionGz: postings.descriptionGz,
      })
      .from(postings)
      .innerJoin(companies, eq(postings.companyId, companies.id))
      .where(eq(postings.id, postingId))
      .get();

    if (row === undefined) {
      return null;
    }

    const context = await contextFor(userId);
    const cached = cachedMatch(userId, postingId, context);

    if (cached !== null) {
      return cached;
    }

    const tags = catalogDb
      .select({ dimension: postingTags.dimension, value: postingTags.value })
      .from(postingTags)
      .where(eq(postingTags.postingId, postingId))
      .all();

    const salary =
      row.salaryMinMinor === null || row.salaryCurrency === null
        ? "none listed"
        : `${row.salaryCurrency} ${String(Math.round(row.salaryMinMinor / 100))} per ${row.salaryPeriod ?? "year"}`;

    const requests = [
      scoreRequest({
        customId: "score-open",
        title: row.title,
        company: row.companyName,
        location: row.locationRaw ?? "unknown",
        workplace: row.workplace,
        employmentType: row.employmentType,
        salary,
        tags: scoreTagsLine(tags),
        summary: descriptionSummary(row.descriptionGz),
        targets: context.targetsLine,
        resumeDigest: context.resumeDigest,
      }),
    ];

    const scores = await runScoreRequests(userId, requests);
    const output = scores.get("score-open");

    if (output === undefined) {
      return null;
    }

    writeMatch(userId, postingId, 0, output, context);

    return { score: output.score, reason: truncateReason(output.reason) };
  }

  async function scoreOnOpen(userId: string, postingId: string) {
    const refused = await candidates.check(userId, postingId);

    if (refused !== null) {
      const existing = applicationFor(db, userId, postingId);

      return { applicationId: existing?.id ?? null, reason: null, score: null };
    }

    const scored = await scorePosting(userId, postingId);

    if (scored === null) {
      return null;
    }

    const existing = applicationFor(db, userId, postingId);

    return { ...scored, applicationId: existing?.id ?? null };
  }

  async function applyManually(userId: string, postingId: string) {
    const existing = applicationFor(db, userId, postingId);

    if (existing !== undefined) {
      return { applicationId: existing.id, created: false };
    }

    const refused = await candidates.check(userId, postingId);

    if (refused !== null) {
      return { refused };
    }

    const scored = await scorePosting(userId, postingId);

    if (scored === null) {
      return null;
    }

    const applicationId = createApplication({ db, catalogDb }, clock.now(), {
      origin: "manual",
      postingId,
      score: scored.score,
      userId,
    });

    if (applicationId === null) {
      return null;
    }

    enqueueApplicationPrepare(db, clock, applicationId);

    return { applicationId, created: true };
  }

  async function fill(userId: string) {
    const settings = await targetsService.read(userId);
    const { languages } = await languagesService.read(userId);
    const at = clock.now();
    const createdIds: string[] = [];

    const list = await candidates.ranked(userId, settings.targets, languages);

    for (const candidate of list) {
      db.insert(matches)
        .values({ userId, postingId: candidate.id, codeRank: candidate.codeRank })
        .onConflictDoUpdate({
          target: [matches.userId, matches.postingId],
          set: { codeRank: candidate.codeRank },
        })
        .run();
    }

    const context = await contextFor(userId);

    if (list.length === 0) {
      return {
        applicationsCreated: 0,
        blocked: false,
        candidates: 0,
        createdIds,
        scored: 0,
      };
    }

    const dailyCap = getSettingNumber(db, "limits.daily_cap");
    const limit = Math.max(0, Math.min(dailyCap, applicationsLeft(db, userId, at)));

    const waiting =
      db
        .select({ total: count() })
        .from(applications)
        .where(and(eq(applications.userId, userId), inArray(applications.status, WAITING_STATUSES)))
        .get()?.total ?? 0;

    let need = Math.max(0, limit - waiting);

    if (need === 0) {
      return {
        applicationsCreated: 0,
        blocked: false,
        candidates: list.length,
        createdIds,
        scored: 0,
      };
    }

    const companiesUsed = activeApplicationCompanies(db, userId);
    let scored = 0;
    let applicationsCreated = 0;
    const scoreAttemptBound = dailyCap * SCORE_ATTEMPT_MULTIPLE;
    let scoreAttempts = 0;

    function offerApplication(candidate: RankedCandidate, score: number) {
      if (need <= 0 || score < context.threshold || companiesUsed.has(candidate.companyId)) {
        return;
      }

      const created = createApplication({ db, catalogDb }, clock.now(), {
        origin: "auto",
        postingId: candidate.id,
        score,
        userId,
      });

      if (created !== null) {
        companiesUsed.add(candidate.companyId);
        applicationsCreated += 1;
        createdIds.push(created);
        need -= 1;
      }
    }

    for (const candidate of list) {
      if (need <= 0) {
        break;
      }

      const cached = cachedMatch(userId, candidate.id, context);

      if (cached !== null) {
        offerApplication(candidate, cached.score);
      }
    }

    const unscored: RankedCandidate[] = [];
    let blocked = false;

    for (const candidate of list) {
      if (need <= 0) {
        break;
      }

      if (cachedMatch(userId, candidate.id, context) === null) {
        unscored.push(candidate);
      }
    }

    async function scoreNextChunk(start: number) {
      if (start >= unscored.length || need <= 0) {
        return;
      }

      const budget = scoreAttemptBound - scoreAttempts;

      if (budget <= 0) {
        return;
      }

      const chunk = unscored.slice(start, start + Math.min(CHUNK_SIZE, need, budget));
      const descriptions = descriptionsFor(chunk.map((candidate) => candidate.id));

      const requests = chunk.map((candidate, index) =>
        scoreRequest({
          customId: `score-${String(index)}`,
          title: candidate.title,
          company: candidate.companyName,
          location: candidate.locationRaw ?? "unknown",
          workplace: candidate.workplace,
          employmentType: candidate.employmentType,
          salary:
            candidate.salaryMinMinor === null || candidate.salaryCurrency === null
              ? "none listed"
              : `${candidate.salaryCurrency} ${String(Math.round(candidate.salaryMinMinor / 100))} per ${candidate.salaryPeriod ?? "year"}`,
          tags: scoreTagsLine(candidate.tags),
          summary: descriptionSummary(descriptions.get(candidate.id) ?? null),
          targets: context.targetsLine,
          resumeDigest: context.resumeDigest,
        }),
      );

      const results = await runScoreRequests(userId, requests);

      if (results.size === 0) {
        blocked = true;

        return;
      }

      scoreAttempts += chunk.length;

      let scoredThisChunk = 0;

      for (const [index, candidate] of chunk.entries()) {
        const output = results.get(`score-${String(index)}`);

        if (output === undefined) {
          continue;
        }

        scoredThisChunk += 1;
        scored += 1;
        writeMatch(userId, candidate.id, candidate.codeRank, output, context);
        offerApplication(candidate, output.score);
      }

      if (scoredThisChunk === 0) {
        return;
      }

      await scoreNextChunk(start + chunk.length);
    }

    await scoreNextChunk(0);

    const boundHit =
      need > 0 && scoreAttempts >= scoreAttemptBound && scoreAttempts < unscored.length;

    if (boundHit) {
      raiseAlert(db, clock, "match.score_bound", {
        attempts: scoreAttempts,
        bound: scoreAttemptBound,
        candidates: unscored.length,
        need,
        threshold: context.threshold,
      });
    }

    return {
      applicationsCreated,
      blocked,
      candidates: list.length,
      createdIds,
      scored,
    };
  }

  async function upNext(userId: string, limit: number) {
    const settings = await targetsService.read(userId);
    const { languages } = await languagesService.read(userId);
    const list = await candidates.ranked(userId, settings.targets, languages);
    const chosen = list.slice(0, limit);

    if (chosen.length === 0) {
      return [];
    }

    const ids = chosen.map((candidate) => candidate.id);

    const matchRows = db
      .select({ postingId: matches.postingId, score: matches.score, reason: matches.reason })
      .from(matches)
      .where(and(eq(matches.userId, userId), inArray(matches.postingId, ids)))
      .all();

    const scores = new Map(matchRows.map((row) => [row.postingId, row]));

    const stateRows = db
      .select({ postingId: postingUserState.postingId, state: postingUserState.state })
      .from(postingUserState)
      .where(and(eq(postingUserState.userId, userId), inArray(postingUserState.postingId, ids)))
      .all();

    const states = new Map(stateRows.map((row) => [row.postingId, row.state]));

    return chosen.map((candidate) => {
      const matched = scores.get(candidate.id);

      return {
        id: candidate.id,
        title: candidate.title,
        company: candidate.companyName,
        location: candidate.locationRaw,
        workplace: candidate.workplace,
        employmentType: candidate.employmentType,
        salaryMinMinor: candidate.salaryMinMinor,
        salaryCurrency: candidate.salaryCurrency,
        salaryPeriod: candidate.salaryPeriod,
        codeRank: candidate.codeRank,
        score: matched?.score ?? null,
        reason: matched?.reason ?? null,
        strong: (matched?.score ?? 0) >= getSettingNumber(db, "match.strong"),
        saved: states.get(candidate.id) === "saved",
      };
    });
  }

  async function preview(userId: string, limit: number) {
    const settings = await targetsService.read(userId);
    const { languages } = await languagesService.read(userId);
    const list = await candidates.ranked(userId, settings.targets, languages);
    const chosen = list.slice(0, limit);

    if (chosen.length === 0) {
      return { items: [], poolCount: 0 };
    }

    const ids = chosen.map((candidate) => candidate.id);

    const matchRows = db
      .select({ postingId: matches.postingId, score: matches.score, reason: matches.reason })
      .from(matches)
      .where(and(eq(matches.userId, userId), inArray(matches.postingId, ids)))
      .all();

    const scores = new Map(matchRows.map((row) => [row.postingId, row]));
    const threshold = getSettingNumber(db, "match.strong");

    return {
      poolCount: list.length,
      items: chosen.map((candidate) => {
        const matched = scores.get(candidate.id);
        const score = matched?.score ?? Math.min(100, Math.round(candidate.codeRank));

        return {
          employmentType: candidate.employmentType,
          id: candidate.id,
          location: candidate.locationRaw,
          salaryCurrency: candidate.salaryCurrency,
          salaryMinMinor: candidate.salaryMinMinor,
          salaryPeriod: candidate.salaryPeriod,
          score,
          strong: score >= threshold,
          title: candidate.title,
          company: candidate.companyName,
          workplace: candidate.workplace,
          reason: matched?.reason ?? null,
          why: whyBullets(candidate, settings.targets),
        };
      }),
    };
  }

  async function prepareOne(userId: string, postingId: string) {
    const existing = applicationFor(db, userId, postingId);

    if (existing !== undefined) {
      return existing.id;
    }

    const refused = await candidates.check(userId, postingId);

    if (refused !== null) {
      return null;
    }

    const applicationId = createApplication({ db, catalogDb }, clock.now(), {
      origin: "manual",
      postingId,
      score: null,
      userId,
    });

    if (applicationId === null) {
      return null;
    }

    enqueueApplicationPrepare(db, clock, applicationId);

    return applicationId;
  }

  async function prepareFrom(
    userId: string,
    postingIds: readonly string[],
    index: number,
    created: readonly string[],
  ) {
    const postingId = postingIds.at(index);

    if (postingId === undefined) {
      return [...created];
    }

    const applicationId = await prepareOne(userId, postingId);
    const next = applicationId === null ? created : [...created, applicationId];

    return prepareFrom(userId, postingIds, index + 1, next);
  }

  async function prepareChosen(userId: string, postingIds: readonly string[]) {
    return prepareFrom(userId, postingIds, 0, []);
  }

  return { applyManually, fill, prepareChosen, preview, scoreOnOpen, upNext };
}

export type MatchingService = ReturnType<typeof createMatchingService>;
