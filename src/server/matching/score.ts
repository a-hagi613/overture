import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmOutputSchema, LlmPort, LlmRequest } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { RankedCandidate } from "./candidates.ts";
import type { PostingDisplay } from "./applications.ts";

import { matches, postingUserState, profiles, resumes, users } from "../platform/db/schema.ts";
import { companies, postingTags, postings } from "../platform/db/catalog-schema.ts";

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
import { applicationFor, createApplication, createClosedApplication } from "./applications.ts";
import { createCandidateService } from "./candidates.ts";
import { descriptionSummary, postingRoleName, scoreTagsLine, targetsLine } from "./judge-input.ts";
import { pickStatusOfApplication } from "../../shared/onboarding.ts";

export const SCORE_PURPOSE = "score";

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
}

function truncateReason(reason: string) {
  return reason.trim().slice(0, 140);
}

const SALARY_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function whyBullets(candidate: RankedCandidate) {
  const bullets: string[] = [];
  const role = postingRoleName(candidate.tags);

  if (role !== null) {
    bullets.push(`Matches your ${role} target`);
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
    };
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

    if (requests.length === 0 || !spendGate.allowsOnboarding(userId)) {
      return scores;
    }

    const estimated = llm.estimateBatchCostMicros(requests);

    const account = db
      .select({ onboardedAt: profiles.onboardedAt, role: users.role, running: profiles.running })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, userId))
      .get();

    const onboardingMatching =
      account === undefined
        ? false
        : account.onboardedAt === null &&
          account.role !== "owner" &&
          account.role !== "demo" &&
          !account.running;

    const caps = checkLlmCaps(db, clock, {
      userId,
      purpose: SCORE_PURPOSE,
      estimatedCostMicros: estimated,
      onboardingMatching,
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
        const score = matched?.score ?? null;

        return {
          employmentType: candidate.employmentType,
          id: candidate.id,
          location: candidate.locationRaw,
          salaryCurrency: candidate.salaryCurrency,
          salaryMinMinor: candidate.salaryMinMinor,
          salaryPeriod: candidate.salaryPeriod,
          score,
          strong: score !== null && score >= threshold,
          title: candidate.title,
          company: candidate.companyName,
          workplace: candidate.workplace,
          reason: matched?.reason ?? null,
          why: whyBullets(candidate),
        };
      }),
    };
  }

  async function preparePick(userId: string, pick: { display: PostingDisplay; postingId: string }) {
    const existing = applicationFor(db, userId, pick.postingId);

    if (existing !== undefined) {
      const status = pickStatusOfApplication(existing.status, existing.statusReason);

      return {
        applicationId: existing.id,
        postingId: pick.postingId,
        reason: null,
        status: status === "picked" ? ("preparing" as const) : status,
      };
    }

    const refused = await candidates.check(userId, pick.postingId);

    if (refused === "closed" || refused === "apply_unsupported") {
      const closedId = createClosedApplication(db, clock.now(), {
        display: pick.display,
        postingId: pick.postingId,
        reason: refused === "closed" ? "posting_closed" : "apply_unsupported",
        userId,
      });

      return {
        applicationId: closedId,
        postingId: pick.postingId,
        reason: refused === "closed" ? ("posting_closed" as const) : ("apply_unsupported" as const),
        status: refused === "closed" ? ("closed" as const) : ("failed" as const),
      };
    }

    const applicationId = createApplication(
      { db, catalogDb },
      clock.now(),
      { origin: "pick", postingId: pick.postingId, score: null, userId },
      pick.display,
    );

    if (applicationId === null) {
      return {
        applicationId: applicationFor(db, userId, pick.postingId)?.id ?? null,
        postingId: pick.postingId,
        reason: "posting_closed" as const,
        status: "closed" as const,
      };
    }

    enqueueApplicationPrepare(db, clock, applicationId);

    return {
      applicationId,
      postingId: pick.postingId,
      reason: null,
      status: "preparing" as const,
    };
  }

  async function preparePicks(
    userId: string,
    picks: readonly { display: PostingDisplay; postingId: string }[],
  ) {
    const results = await Promise.all(picks.map(async (pick) => preparePick(userId, pick)));

    return new Map(results.map((result) => [result.postingId, result]));
  }

  return { applyManually, preparePicks, preview, scoreOnOpen, upNext };
}

export type MatchingService = ReturnType<typeof createMatchingService>;
