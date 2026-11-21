import { desc } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { adminAudit } from "../db/schema.ts";

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

function rowOfAudit(row: typeof adminAudit.$inferSelect) {
  const parsed = auditDetailSchema.safeParse(JSON.parse(row.detail));

  return {
    id: row.id,
    at: new Date(row.at),
    actorId: row.actorId,
    action: row.action,
    targetUserId: row.targetUserId,
    reason: row.reason,
    detail: parsed.success ? parsed.data : {},
  };
}

export function recordAdminAudit(db: AppDatabase, clock: Clock, entry: AdminAuditEntry) {
  const id = crypto.randomUUID();

  db.insert(adminAudit)
    .values({
      id,
      at: clock.now(),
      actorId: entry.actorId,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      reason: entry.reason ?? "",
      detail: JSON.stringify(entry.detail ?? {}),
    })
    .run();

  return id;
}

export function listAdminAudit(db: AppDatabase, limit: number) {
  return db
    .select()
    .from(adminAudit)
    .orderBy(desc(adminAudit.at))
    .limit(limit)
    .all()
    .map((row) => rowOfAudit(row));
}
