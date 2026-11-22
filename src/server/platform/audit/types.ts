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
