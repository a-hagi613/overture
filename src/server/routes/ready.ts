import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { PreparationService } from "../pipeline/prepare.ts";

import {
  applicationEvents,
  applications,
  companies,
  matches,
  postings,
  resumes,
} from "../platform/db/schema.ts";
import { enqueuePlannerDay } from "../dispatch/planner.ts";
import {
  approvalProblem,
  openApprovedPlan,
  sealApprovedPlan,
  sendPlanSha256,
} from "../pipeline/approved-plan.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { stageForStatus } from "../pipeline/stage.ts";

import type { SendPlan } from "../pipeline/send-plan.ts";

const approveBody = z.object({ planSha256: z.string().min(1) });

const approveAllBody = z.object({
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

function changesOf(value: string | null) {
  if (value === null) {
    return [];
  }

  const parsed = z.array(z.string()).safeParse(JSON.parse(value));

  return parsed.success ? parsed.data : [];
}

function answersOf(plan: SendPlan) {
  return plan.fields.map((field) => ({
    answer: field.answer,
    block: field.block,
    byUser: field.sentences.some((sentence) => sentence.byUser === true),
    factKey: field.factKey,
    factRevision: field.factRevision,
    kind: field.answerKind,
    label: field.label,
    questionId: field.questionId,
    required: field.required,
    sentences: field.sentences.map((sentence) => sentence.sentence),
    source: field.source,
  }));
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

  async function sessionUser(headers: Headers) {
    const result = await auth.api.getSession({ headers }).catch(() => null);

    return result?.user ?? null;
  }

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

    const filename = await personal.openFor(
      userId,
      { column: "filename_enc", rowId: row.id, table: "resumes" },
      row.filenameEnc,
    );

    return { filename, uploadedAt: row.uploadedAt.getTime() };
  }

  async function planView(userId: string, plan: SendPlan, planSha256: string) {
    return {
      answers: answersOf(plan),
      consentVersion: plan.consentVersion,
      coverLetter: plan.coverLetter?.map((sentence) => sentence.sentence) ?? null,
      planSha256,
      postingTitle: plan.postingTitle,
      postingUrl: plan.postingUrl,
      resume: await resumeView(userId, plan.resume?.id ?? null),
    };
  }

  async function cardView(userId: string, row: ReadyCardRow, position: number | null) {
    if (row.status === "approved") {
      const approved = await openApprovedPlan({
        applicationId: row.id,
        db,
        personal,
        userId,
      }).catch(() => null);

      return {
        approvedAt: row.approvedAt,
        changes: changesOf(row.changes),
        company: row.company,
        id: row.id,
        location: row.location,
        plan: approved === null ? null : await planView(userId, approved.plan, approved.sha256),
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
      plan: plan === null || planSha256 === null ? null : await planView(userId, plan, planSha256),
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
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const rows: ReadyCardRow[] = db
      .select({
        approvedAt: applications.approvedAt,
        changes: applications.changes,
        company: companies.name,
        id: applications.id,
        location: postings.locationRaw,
        readyAt: applications.readyAt,
        scheduledFor: applications.scheduledFor,
        score: matches.score,
        status: applications.status,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
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

    const cards = await Promise.all(
      rows.map(async (row) =>
        cardView(user.id, row, row.status === "approved" ? approvedIds.indexOf(row.id) + 1 : null),
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
      planSha256: sealed.sha256,
      status: "approved" as const,
    };
  }

  routes.post("/applications/:id/approve", zValidator("json", approveBody), async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();
    const { planSha256 } = context.req.valid("json");

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

    return context.json(result);
  });

  routes.post("/ready/approve", zValidator("json", approveAllBody), async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { items } = context.req.valid("json");
    const userId = user.id;
    const base = clock.now();
    const approved: { approvedAt: number; id: string; planSha256: string }[] = [];
    const refused: { error: string; id: string }[] = [];

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
      }

      await approveFrom(index + 1);
    }

    await approveFrom(0);

    return context.json({ approved, refused });
  });

  routes.post("/applications/:id/unapprove", async (context) => {
    const user = await sessionUser(context.req.raw.headers);

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

  routes.put(
    "/applications/:id/answers/:questionId",
    zValidator("json", answerBody),
    async (context) => {
      const user = await sessionUser(context.req.raw.headers);

      if (user === null) {
        return context.json({ error: "sign_in_required" }, 401);
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
    },
  );

  return routes;
}
