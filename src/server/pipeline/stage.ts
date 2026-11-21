import type { applications } from "../platform/db/schema.ts";

export type ApplicationStatus = (typeof applications.$inferSelect)["status"];

export type BoardStage = NonNullable<(typeof applications.$inferSelect)["stage"]>;

const STAGE_BY_STATUS = {
  approved: "ready",
  confirming: "ready",
  failed: null,
  needs_review: "queued",
  preparing: "queued",
  ready: "ready",
  sending: "ready",
  sent: "applied",
  skipped: null,
  withdrawn: null,
} satisfies Record<ApplicationStatus, BoardStage | null>;

export function stageForStatus(status: ApplicationStatus) {
  return STAGE_BY_STATUS[status];
}
