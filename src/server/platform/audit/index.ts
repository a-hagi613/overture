import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import type { AdminAuditEntry, AdminAuditRow } from "./types.ts";

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

export type { AdminAuditEntry, AdminAuditRow } from "./types.ts";

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

export interface AdminAuditQuery {
  action?: string | undefined;
  actorId?: string | undefined;
  targetUserId?: string | undefined;
  q?: string | undefined;
  limit: number;
  before?: string | undefined;
}

export interface AuditCursor {
  at: number;
  id: string | null;
}

export interface AdminAuditPage {
  entries: AdminAuditRow[];
  nextCursor: string | null;
}

const BARE_CURSOR = /^\d+$/u;
const COMPOSITE_CURSOR = /^(?<at>\d+):(?<id>.+)$/u;

export function parseAuditCursor(raw: string) {
  const trimmed = raw.trim();

  if (BARE_CURSOR.test(trimmed)) {
    const at = Number(trimmed);

    return Number.isSafeInteger(at) ? ({ at, id: null } satisfies AuditCursor) : null;
  }

  const match = COMPOSITE_CURSOR.exec(trimmed);

  if (match?.groups === undefined) {
    return null;
  }

  const at = Number(match.groups.at);
  const id = match.groups.id ?? "";

  if (!Number.isSafeInteger(at) || id.length === 0) {
    return null;
  }

  return { at, id } satisfies AuditCursor;
}

export function formatAuditCursor(row: { at: number; id: string }) {
  return `${String(row.at)}:${row.id}`;
}

export function listAdminAudit(db: AppDatabase, limit: number) {
  return db
    .select()
    .from(adminAudit)
    .orderBy(desc(adminAudit.at), desc(adminAudit.id))
    .limit(limit)
    .all()
    .map((row) => auditRowOfStored(row));
}

export function queryAdminAudit(db: AppDatabase, query: AdminAuditQuery) {
  const conditions: SQL[] = [];
  const action = query.action?.trim() ?? "";
  const actorId = query.actorId?.trim() ?? "";
  const targetUserId = query.targetUserId?.trim() ?? "";
  const needle = query.q?.trim().toLowerCase() ?? "";

  if (action.length > 0) {
    conditions.push(eq(adminAudit.action, action));
  }

  if (actorId.length > 0) {
    conditions.push(eq(adminAudit.actorId, actorId));
  }

  if (targetUserId.length > 0) {
    conditions.push(eq(adminAudit.targetUserId, targetUserId));
  }

  if (needle.length > 0) {
    conditions.push(
      sql`(instr(lower(${adminAudit.action}), ${needle}) > 0 OR instr(lower(${adminAudit.reason}), ${needle}) > 0 OR instr(lower(${adminAudit.detail}), ${needle}) > 0 OR instr(lower(${adminAudit.actorId}), ${needle}) > 0 OR instr(lower(coalesce(${adminAudit.targetUserId}, '')), ${needle}) > 0)`,
    );
  }

  if (query.before !== undefined && query.before.trim().length > 0) {
    const cursor = parseAuditCursor(query.before);

    if (cursor !== null) {
      const clause =
        cursor.id === null
          ? lt(adminAudit.at, cursor.at)
          : or(
              lt(adminAudit.at, cursor.at),
              and(eq(adminAudit.at, cursor.at), lt(adminAudit.id, cursor.id)),
            );

      if (clause !== undefined) {
        conditions.push(clause);
      }
    }
  }

  const limit = Math.min(Math.max(1, Math.trunc(query.limit)), 200);
  const whereClause = conditions.length === 0 ? undefined : and(...conditions);

  const rows = db
    .select()
    .from(adminAudit)
    .where(whereClause)
    .orderBy(desc(adminAudit.at), desc(adminAudit.id))
    .limit(limit + 1)
    .all();

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page.at(-1);

  return {
    entries: page.map((row) => auditRowOfStored(row)),
    nextCursor: hasMore && last !== undefined ? formatAuditCursor(last) : null,
  } satisfies AdminAuditPage;
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
