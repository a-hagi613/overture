import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import type { AdminAuditEntry, AdminAuditRow } from "./index.ts";

import { adminAudit } from "../db/schema.ts";

export function auditRowOf(id: string, at: Date, entry: AdminAuditEntry) {
  return {
    id,
    at,
    actorId: entry.actorId,
    action: entry.action,
    targetUserId: entry.targetUserId ?? null,
    reason: entry.reason ?? "",
    detail: entry.detail ?? {},
  } satisfies AdminAuditRow;
}

export function insertAdminAudit(
  db: Pick<AppDatabase, "insert">,
  clock: Clock,
  entry: AdminAuditEntry,
) {
  const id = crypto.randomUUID();
  const at = clock.now();

  db.insert(adminAudit)
    .values({
      id,
      at,
      actorId: entry.actorId,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      reason: entry.reason ?? "",
      detail: JSON.stringify(entry.detail ?? {}),
    })
    .run();

  return auditRowOf(id, new Date(at), entry);
}
