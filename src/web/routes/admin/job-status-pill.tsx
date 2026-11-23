import { copy } from "../../../shared/copy.ts";
import type { JobStatus } from "../../lib/admin-api.ts";

const STATUS_TONES: Record<JobStatus, string> = {
  dead: "bg-need-soft text-need",
  done: "bg-ok-soft text-ok",
  failed: "bg-need-soft text-need",
  queued: "bg-muted text-muted-foreground",
  running: "bg-signal-soft text-signal-text",
};

const STATUS_LABELS: Record<JobStatus, string> = {
  dead: copy.admin.jobsStatusDead,
  done: copy.admin.jobsStatusDone,
  failed: copy.admin.jobsStatusFailed,
  queued: copy.admin.jobsStatusQueued,
  running: copy.admin.jobsStatusRunning,
};

export function JobStatusPill({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${STATUS_TONES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
