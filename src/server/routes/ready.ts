import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import { readSessionUser } from "../auth/session.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import { openOrNull } from "../profile/personal-crypto.ts";
import type { PreparationService } from "../pipeline/prepare.ts";

import { applicationEvents, applications, facts, matches, resumes } from "../platform/db/schema.ts";
import { enqueuePlannerDay } from "../dispatch/planner.ts";
import {
  approvalProblem,
  openApprovedPlans,
  sealApprovedPlan,
  sendPlanSha256,
} from "../pipeline/approved-plan.ts";
import type { ApprovedPlan } from "../pipeline/approved-plan.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { logInfo } from "../platform/log.ts";
import { isCoverLetterQuestion } from "../pipeline/open-text.ts";
import { stageForStatus } from "../pipeline/stage.ts";
import { demoLocked } from "../demo/guard.ts";
import { planHasGeneratedProse, READY_DWELL_MAX_MS } from "../../shared/ready-approval.ts";

import type { SendPlan } from "../pipeline/send-plan.ts";

const dwellMs = z.number().int().min(0).max(READY_DWELL_MAX_MS).optional();

export const approveBody = z.object({ dwellMs, planSha256: z.string().min(1) });

export const approveAllBody = z.object({
  dwellMs,
  items: z
    .array(z.object({ id: z.string().min(1), planSha256: z.string().min(1) }))
    .min(1)
    .max(50),
});

const answerBody = z.object({ value: z.string().trim().min(1).max(5000) });

const STRONG_SCORE = 80;

interface ReadyCardRow {
  approvedAt: number | null;
  changes: string | null;
  company: string;
  id: string;
  location: string | null;
  readyAt: number | null;
  scheduledFor: number | null;
  score: number | null;
  status: string;
}

export function changesOf(value: string | null) {
  if (value === null) {
    return [];
  }

  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(value));

    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function answersOf(plan: SendPlan, factSources: ReadonlyMap<string, string>) {
  return plan.fields.map((field) => ({
    answer: field.answer,
    block: field.block,
    byUser: field.sentences.some((sentence) => sentence.byUser === true),
    coverLetter: isCoverLetterQuestion(field.label),
    factKey: field.factKey,
    factRevision: field.factRevision,
    factSource:
      field.factKey === null
        ? null
        : (factSources.get(`${field.scope}\u0000${field.factKey}`) ?? null),
    kind: field.answerKind,
    label: field.label,
    questionId: field.questionId,
    required: field.required,
    sentences: field.sentences.map((sentence) => sentence.sentence),
    source: field.source,
  }));
}

function factSourceMap(db: AppDatabase, userId: string) {
  const rows = db
    .select({ key: facts.key, scope: facts.scope, source: facts.source })
    .from(facts)
    .where(eq(facts.userId, userId))
    .all();

  return new Map(rows.map((row) => [`${row.scope}\u0000${row.key}`, row.source] as const));
}

const NO_FACT_SOURCES: ReadonlyMap<string, string> = new Map();

export interface ApprovalTelemetryInput {
  count?: number | undefined;
  dwellMs?: number | undefined;
  hasGeneratedProse: boolean;
  mode: "single" | "batch";
}

interface ReadyApproveEvent {
  count?: number | undefined;
  dwellMs: number | null;
  hasGeneratedProse: boolean;
  mode: "single" | "batch";
}

/**
 * Builds one `ready.approve` event. Dwell time stays an event value, never a
 * metric label, and no Application id is included, so cardinality cannot grow.
 * @param input The approval's mode, dwell time, and whether prose was drafted.
 * @returns The event as compact JSON for the structured log.
 */
export function approvalTelemetryJson(input: ApprovalTelemetryInput) {
  const event: ReadyApproveEvent = {
    dwellMs: input.dwellMs ?? null,
    hasGeneratedProse: input.hasGeneratedProse,
    mode: input.mode,
  };

  if (input.count !== undefined) {
    event.count = input.count;
  }

  return JSON.stringify(event);
}

function generatedProseOf(plan: SendPlan) {
  return planHasGeneratedProse(answersOf(plan, NO_FACT_SOURCES));
}

export function createReadyRoutes(deps: {
  auth: Auth;
  clock: Clock;
  db: AppDatabase;
  personal: PersonalCrypto;
  preparation: PreparationService;
}) {
  const { auth, clock, db, personal, preparation } = deps;
  const routes = new Hono();

  async function resumeView(userId: string, resumeId: string | null) {
    if (resumeId === null) {
      return null;
    }

    const row = db
      .select({ filenameEnc: resumes.filenameEnc, id: resumes.id, uploadedAt: resumes.uploadedAt })
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .get();

    if (row === undefined) {
      return null;
    }

    const filename =
      (await openOrNull({
        personal,
        scope: { column: "filename_enc", rowId: row.id, table: "resumes" },
        sealed: row.filenameEnc,
        userId,
      })) ?? "resume.pdf";

    return { filename, uploadedAt: row.uploadedAt.getTime() };
  }

  async function planView(
    userId: string,
    plan: SendPlan,
    planSha256: string,
    factSources: ReadonlyMap<string, string>,
  ) {
    const answers = answersOf(plan, factSources);

    return {
      answers,
      consentVersion: plan.consentVersion,
      coverLetter: plan.coverLetter?.map((sentence) => sentence.sentence) ?? null,
      hasGeneratedProse: planHasGeneratedProse(answers),
      planSha256,
      postingTitle: plan.postingTitle,
      postingUrl: plan.postingUrl,
      resume: await resumeView(userId, plan.resume?.id ?? null),
    };
  }

  async function cardView(
    userId: string,
    row: ReadyCardRow,
    position: number | null,
    factSources: ReadonlyMap<string, string>,
    approvedPlans: ReadonlyMap<string, ApprovedPlan>,
  ) {
    if (row.status === "approved") {
      const approved = approvedPlans.get(row.id) ?? null;

      return {
        approvedAt: row.approvedAt,
        changes: changesOf(row.changes),
        company: row.company,
        id: row.id,
        location: row.location,
        plan:
          approved === null
            ? null
            : await planView(userId, approved.plan, approved.sha256, factSources),
        queuePosition: position,
        readyAt: row.readyAt,
        score: row.score,
        sendAt: row.scheduledFor,
        status: row.status,
        strong: row.score !== null && row.score >= STRONG_SCORE,
        title: approved?.plan.postingTitle ?? null,
      };
    }

    const plan = await preparation.sendPlanFor(row.id);
    const planSha256 = plan === null ? null : sendPlanSha256(plan);

    return {
      approvedAt: row.approvedAt,
      changes: changesOf(row.changes),
      company: row.company,
      id: row.id,
      location: row.location,
      plan:
        plan === null || planSha256 === null
          ? null
          : await planView(userId, plan, planSha256, factSources),
      queuePosition: position,
      readyAt: row.readyAt,
      score: row.score,
      sendAt: row.scheduledFor,
      status: row.status,
      strong: row.score !== null && row.score >= STRONG_SCORE,
      title: plan?.postingTitle ?? null,
    };
  }

  routes.get("/ready", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const rows: ReadyCardRow[] = db
      .select({
        approvedAt: applications.approvedAt,
        changes: applications.changes,
        company: applications.companyName,
        id: applications.id,
        location: applications.locationRaw,
        readyAt: applications.readyAt,
        scheduledFor: applications.scheduledFor,
        score: matches.score,
        status: applications.status,
      })
      .from(applications)
      .leftJoin(
        matches,
        and(eq(matches.userId, applications.userId), eq(matches.postingId, applications.postingId)),
      )
      .where(
        and(eq(applications.userId, user.id), inArray(applications.status, ["ready", "approved"])),
      )
      .orderBy(asc(applications.approvedAt), asc(applications.readyAt), asc(applications.createdAt))
      .all();

    const approvedIds = rows.flatMap((row) => (row.status === "approved" ? [row.id] : []));
    const factSources = factSourceMap(db, user.id);

    const approvedPlans = await openApprovedPlans({
      applicationIds: approvedIds,
      db,
      personal,
      userId: user.id,
    });

    const cards = await Promise.all(
      rows.map(async (row) =>
        cardView(
          user.id,
          row,
          row.status === "approved" ? approvedIds.indexOf(row.id) + 1 : null,
          factSources,
          approvedPlans,
        ),
      ),
    );

    const sendTimes = cards.flatMap((card) =>
      card.status === "approved" && card.sendAt !== null ? [card.sendAt] : [],
    );

    return context.json({
      approved: approvedIds.length,
      cards,
      nextSendAt: sendTimes.length === 0 ? null : Math.min(...sendTimes),
      ready: rows.filter((row) => row.status === "ready").length,
    });
  });

  async function approveOne(input: {
    applicationId: string;
    approvedAt: number;
    planSha256: string;
    userId: string;
  }) {
    const row = db
      .select({ id: applications.id, status: applications.status })
      .from(applications)
      .where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.userId)))
      .get();

    if (row === undefined) {
      return { error: "not_found" as const };
    }

    if (row.status !== "ready") {
      return { error: "not_ready" as const };
    }

    const plan = await preparation.sendPlanFor(input.applicationId);

    if (plan === null) {
      return { error: "not_ready" as const };
    }

    const currentSha256 = sendPlanSha256(plan);

    if (currentSha256 !== input.planSha256) {
      return { error: "plan_changed" as const, planSha256: currentSha256 };
    }

    const problem = approvalProblem(db, input.userId, plan);

    if (problem !== null) {
      return { error: "plan_changed" as const, planSha256: currentSha256 };
    }

    const sealed = await sealApprovedPlan({
      applicationId: input.applicationId,
      personal,
      plan,
    });

    const now = clock.now();

    const updated = db.transaction((tx) => {
      const claim = tx
        .update(applications)
        .set({
          approvedAt: input.approvedAt,
          approvedPlanEnc: sealed.enc,
          approvedPlanSha256: sealed.sha256,
          changes: null,
          scheduledFor: null,
          stage: stageForStatus("approved"),
          status: "approved",
          statusReason: null,
          updatedAt: now,
        })
        .where(and(eq(applications.id, input.applicationId), eq(applications.status, "ready")))
        .returning({ id: applications.id })
        .all()
        .at(0);

      if (claim === undefined) {
        return null;
      }

      tx.insert(applicationEvents)
        .values({
          applicationId: input.applicationId,
          at: now,
          detail: null,
          fromValue: "ready",
          id: crypto.randomUUID(),
          kind: "status",
          source: "user",
          toValue: "approved",
          userId: input.userId,
        })
        .run();

      return claim;
    });

    if (updated === null) {
      return { error: "not_ready" as const };
    }

    enqueuePlannerDay(db, clock, input.userId);
    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: input.applicationId, status: "approved" }),
      input.userId,
    );
    publishEvent(db, clock, "home.updated", JSON.stringify({ approved: true }), input.userId);

    return {
      approvedAt: input.approvedAt,
      hasGeneratedProse: generatedProseOf(plan),
      planSha256: sealed.sha256,
      status: "approved" as const,
    };
  }

  routes.post("/applications/:id/approve", validJson(approveBody), async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();
    const { dwellMs: dwell, planSha256 } = context.req.valid("json");

    const result = await approveOne({
      applicationId: id,
      approvedAt: clock.now(),
      planSha256,
      userId: user.id,
    });

    if ("error" in result) {
      if (result.error === "not_found") {
        return context.json({ error: result.error }, 404);
      }

      if (result.error === "plan_changed") {
        return context.json({ error: result.error, planSha256: result.planSha256 }, 409);
      }

      return context.json({ error: result.error }, 409);
    }

    logInfo(
      "ready.approve",
      approvalTelemetryJson({
        dwellMs: dwell,
        hasGeneratedProse: result.hasGeneratedProse,
        mode: "single",
      }),
    );

    return context.json(result);
  });

  routes.post("/ready/approve", validJson(approveAllBody), async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { dwellMs: dwell, items } = context.req.valid("json");
    const userId = user.id;
    const base = clock.now();
    const approved: { approvedAt: number; id: string; planSha256: string }[] = [];
    const refused: { error: string; id: string }[] = [];

    const needsReview = (
      await Promise.all(
        items.map(async (item) => {
          const row = db
            .select({ status: applications.status })
            .from(applications)
            .where(and(eq(applications.id, item.id), eq(applications.userId, userId)))
            .get();

          if (row?.status !== "ready") {
            return null;
          }

          const plan = await preparation.sendPlanFor(item.id);

          return plan !== null && generatedProseOf(plan) ? item.id : null;
        }),
      )
    ).filter((id): id is string => id !== null);

    if (needsReview.length > 0) {
      return context.json({ applications: needsReview, error: "requires_individual_review" }, 422);
    }

    async function approveFrom(index: number) {
      const item = items[index];

      if (item === undefined) {
        return;
      }

      const result = await approveOne({
        applicationId: item.id,
        approvedAt: base + index,
        planSha256: item.planSha256,
        userId,
      });

      if ("error" in result) {
        refused.push({ error: result.error, id: item.id });
      } else {
        approved.push({
          approvedAt: result.approvedAt,
          id: item.id,
          planSha256: result.planSha256,
        });
        logInfo(
          "ready.approve",
          approvalTelemetryJson({
            dwellMs: dwell,
            hasGeneratedProse: result.hasGeneratedProse,
            mode: "batch",
          }),
        );
      }

      await approveFrom(index + 1);
    }

    await approveFrom(0);

    return context.json({ approved, refused });
  });

  routes.post("/applications/:id/unapprove", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();

    const row = db
      .select({ id: applications.id, status: applications.status })
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
      .get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const now = clock.now();

    const updated = db.transaction((tx) => {
      const claim = tx
        .update(applications)
        .set({
          approvedAt: null,
          approvedPlanEnc: null,
          approvedPlanSha256: null,
          changes: null,
          scheduledFor: null,
          stage: stageForStatus("ready"),
          status: "ready",
          statusReason: null,
          updatedAt: now,
        })
        .where(and(eq(applications.id, id), eq(applications.status, "approved")))
        .returning({ id: applications.id })
        .all()
        .at(0);

      if (claim === undefined) {
        return null;
      }

      tx.insert(applicationEvents)
        .values({
          applicationId: id,
          at: now,
          detail: null,
          fromValue: "approved",
          id: crypto.randomUUID(),
          kind: "status",
          source: "user",
          toValue: "ready",
          userId: user.id,
        })
        .run();

      return row;
    });

    if (updated === null) {
      return context.json({ error: "not_approved" }, 409);
    }

    enqueuePlannerDay(db, clock, user.id);
    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: id, status: "ready" }),
      user.id,
    );
    publishEvent(db, clock, "home.updated", JSON.stringify({ approved: false }), user.id);

    return context.json({ status: "ready" });
  });

  routes.put("/applications/:id/answers/:questionId", validJson(answerBody), async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const locked = demoLocked(user.role);

    if (locked !== null) {
      return locked;
    }

    const { id, questionId } = context.req.param();
    const { value } = context.req.valid("json");

    const result = await preparation.editAnswer({
      applicationId: id,
      questionId,
      userId: user.id,
      value,
    });

    if (result.kind === "saved") {
      return context.json({
        answer: result.answer,
        applicationId: id,
        byUser: result.byUser,
        factKey: result.factKey,
        factRevision: result.factRevision,
        questionId,
        status: "ready",
      });
    }

    if (result.kind === "not_found" || result.kind === "question_not_found") {
      return context.json({ error: result.kind }, 404);
    }

    if (result.kind === "invalid_answer") {
      return context.json({ error: result.kind }, 422);
    }

    return context.json({ error: result.kind }, 409);
  });

  return routes;
}
