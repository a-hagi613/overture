import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminAuditRow } from "./index.ts";
import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { adminAudit } from "../db/schema.ts";
import { auditRowOfStored, recordAdminAudit } from "./index.ts";

export const REVEAL_DURATION_MS = 15 * 60 * 1000;

export const REVEAL_PASSKEY_WINDOW_MS = 5 * 60 * 1000;

const REVEAL_STATE_ACTIONS = ["reveal.open", "reveal.close", "reveal.expired"] as const;

const revealDetailSchema = z.object({
  cause: z.string().optional(),
  expiresAt: z.number().int().optional(),
  revealId: z.string().min(1),
  view: z.string().optional(),
});

export interface RevealSession {
  id: string;
  actorId: string;
  targetUserId: string;
  reason: string;
  openedAt: number;
  expiresAt: number;
}

interface RevealInspection {
  session: RevealSession;
  expired: boolean;
}

export interface RevealOpenInput {
  actorId: string;
  targetUserId: string;
  reason: string;
  passkeyAssertedAt: number;
}

function revealStateRows(db: AppDatabase, actorId: string) {
  return db
    .select()
    .from(adminAudit)
    .where(
      and(eq(adminAudit.actorId, actorId), inArray(adminAudit.action, [...REVEAL_STATE_ACTIONS])),
    )
    .orderBy(desc(sql.raw("rowid")))
    .limit(100)
    .all()
    .map((row) => auditRowOfStored(row));
}

function inspectionOf(rows: readonly AdminAuditRow[], now: number) {
  const ended = new Set<string>();

  for (const row of rows) {
    const detail = revealDetailSchema.safeParse(row.detail);

    if (!detail.success) {
      continue;
    }

    if (row.action === "reveal.close" || row.action === "reveal.expired") {
      ended.add(detail.data.revealId);
      continue;
    }

    if (ended.has(detail.data.revealId) || detail.data.expiresAt === undefined) {
      continue;
    }

    return {
      expired: detail.data.expiresAt <= now,
      session: {
        id: detail.data.revealId,
        actorId: row.actorId,
        targetUserId: row.targetUserId ?? "",
        reason: row.reason,
        openedAt: row.at.getTime(),
        expiresAt: detail.data.expiresAt,
      },
    } satisfies RevealInspection;
  }

  return null;
}

function inspectReveal(db: AppDatabase, clock: Clock, actorId: string) {
  return inspectionOf(revealStateRows(db, actorId), clock.now());
}

async function recordExpiredReveal(db: AppDatabase, clock: Clock, inspection: RevealInspection) {
  await recordAdminAudit(db, clock, {
    actorId: inspection.session.actorId,
    action: "reveal.expired",
    targetUserId: inspection.session.targetUserId,
    reason: "The 15-minute Reveal ended",
    detail: { cause: "expired", revealId: inspection.session.id },
  });
}

export async function activeReveal(db: AppDatabase, clock: Clock, actorId: string) {
  const inspection = inspectReveal(db, clock, actorId);

  if (inspection === null) {
    return null;
  }

  if (!inspection.expired) {
    return inspection.session;
  }

  await recordExpiredReveal(db, clock, inspection);

  return null;
}

export async function openReveal(db: AppDatabase, clock: Clock, input: RevealOpenInput) {
  const inspection = inspectReveal(db, clock, input.actorId);

  if (inspection !== null) {
    if (inspection.expired) {
      await recordExpiredReveal(db, clock, inspection);
    } else {
      await recordAdminAudit(db, clock, {
        actorId: input.actorId,
        action: "reveal.close",
        targetUserId: inspection.session.targetUserId,
        reason: "Superseded by a new Reveal",
        detail: { cause: "superseded", revealId: inspection.session.id },
      });
    }
  }

  const id = crypto.randomUUID();
  const openedAt = clock.now();
  const expiresAt = openedAt + REVEAL_DURATION_MS;

  await recordAdminAudit(db, clock, {
    actorId: input.actorId,
    action: "reveal.open",
    targetUserId: input.targetUserId,
    reason: input.reason,
    detail: { expiresAt, passkeyAssertedAt: input.passkeyAssertedAt, revealId: id },
  });

  return {
    id,
    actorId: input.actorId,
    targetUserId: input.targetUserId,
    reason: input.reason,
    openedAt,
    expiresAt,
  } satisfies RevealSession;
}

export async function closeReveal(db: AppDatabase, clock: Clock, actorId: string) {
  const inspection = inspectReveal(db, clock, actorId);

  if (inspection === null) {
    return null;
  }

  if (inspection.expired) {
    await recordExpiredReveal(db, clock, inspection);

    return null;
  }

  await recordAdminAudit(db, clock, {
    actorId,
    action: "reveal.close",
    targetUserId: inspection.session.targetUserId,
    reason: "Closed from the admin",
    detail: { cause: "manual", revealId: inspection.session.id },
  });

  return inspection.session;
}

export async function recordRevealView(
  db: AppDatabase,
  clock: Clock,
  session: RevealSession,
  view: string,
) {
  await recordAdminAudit(db, clock, {
    actorId: session.actorId,
    action: "reveal.view",
    targetUserId: session.targetUserId,
    reason: session.reason,
    detail: { revealId: session.id, view },
  });
}
