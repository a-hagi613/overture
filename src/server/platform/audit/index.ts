import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { SpanStatusCode } from "@opentelemetry/api";

import { adminAudit } from "../db/schema.ts";
import { logError } from "../log.ts";
import { lokiAuditConfig, shipAuditToLoki } from "./loki.ts";
import { insertAdminAudit } from "./insert.ts";
import { trace } from "../telemetry/otel.ts";

const auditDetailSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export interface AdminAuditEntry {
  actorId: string;
  action: string;
  targetUserId?: string;
  reason?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface AdminAuditRow {
  id: string;
  at: Date;
  actorId: string;
  action: string;
  targetUserId: string | null;
  reason: string;
  detail: Record<string, string | number | boolean | null>;
}

export function auditRowOfStored(row: typeof adminAudit.$inferSelect) {
  const parsed = auditDetailSchema.safeParse(JSON.parse(row.detail));

  return {
    id: row.id,
    at: new Date(row.at),
    actorId: row.actorId,
    action: row.action,
    targetUserId: row.targetUserId,
    reason: row.reason,
    detail: parsed.success ? parsed.data : {},
  } satisfies AdminAuditRow;
}

export function startAuditSpan(action: string, targetUserId: string | undefined) {
  return trace.getTracer("overture").startSpan("admin.audit", {
    attributes: {
      "admin.action": action,
      "admin.target_user_id": targetUserId ?? "",
    },
  });
}

export function failAuditSpan(span: ReturnType<typeof startAuditSpan>, cause: unknown) {
  logError("admin.audit", cause);
  span.setStatus({ code: SpanStatusCode.ERROR });
}

export async function shipAdminAudit(row: AdminAuditRow) {
  const config = lokiAuditConfig();

  if (config !== null) {
    await shipAuditToLoki(config, row);
  }
}

export async function recordAdminAudit(db: AppDatabase, clock: Clock, entry: AdminAuditEntry) {
  const span = startAuditSpan(entry.action, entry.targetUserId);

  try {
    const row = insertAdminAudit(db, clock, entry);

    await shipAdminAudit(row);

    return row.id;
  } catch (error) {
    failAuditSpan(span, error);

    throw error;
  } finally {
    span.end();
  }
}

export function listAdminAudit(db: AppDatabase, limit: number) {
  return db
    .select()
    .from(adminAudit)
    .orderBy(desc(adminAudit.at))
    .limit(limit)
    .all()
    .map((row) => auditRowOfStored(row));
}

export function listAdminAuditForActor(db: AppDatabase, actorId: string) {
  return listAdminAudit(db, 100).filter((row) => row.actorId === actorId);
}

export function listAdminAuditForUser(db: AppDatabase, userId: string, limit: number) {
  return db
    .select()
    .from(adminAudit)
    .where(eq(adminAudit.targetUserId, userId))
    .orderBy(desc(adminAudit.at), desc(sql.raw("rowid")))
    .limit(limit)
    .all()
    .map((row) => auditRowOfStored(row));
}
