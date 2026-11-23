import { copy } from "../../../shared/copy.ts";
import type { JobRow } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { JobActions } from "./job-actions.tsx";
import type { PendingJobAction } from "./job-actions.tsx";
import { JobError } from "./job-error.tsx";
import { JobStatusPill } from "./job-status-pill.tsx";
import { JobTiming } from "./job-timing.tsx";

export function JobList({
  busyId,
  jobs,
  now,
  onAction,
  pending,
  setPending,
}: {
  busyId: string | null;
  jobs: JobRow[];
  now: number;
  onAction: (job: JobRow, action: "retry" | "cancel") => void;
  pending: PendingJobAction | null;
  setPending: (action: PendingJobAction | null) => void;
}) {
  return (
    <ul
      aria-label={copy.admin.navJobs}
      className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sh md:hidden"
    >
      {jobs.length === 0 ? (
        <li className="px-4 py-6 text-sm text-muted-foreground">{copy.admin.jobsEmpty}</li>
      ) : (
        jobs.map((job) => (
          <li className="px-4 py-4" key={job.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="block break-all font-mono text-xs text-muted-foreground">
                  {job.id}
                </span>
                <span className="mt-1 block break-all text-sm font-semibold">{job.kind}</span>
              </div>
              <JobStatusPill status={job.status} />
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{copy.admin.jobsColumnAttempts}</dt>
                <dd className="font-mono tabular-nums">
                  {copy.admin.jobsAttempts(job.attempts, job.maxAttempts)}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{copy.admin.jobsColumnRunAt}</dt>
                <dd>
                  <JobTiming job={job} now={now} />
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{copy.admin.jobsColumnUpdated}</dt>
                <dd className="font-mono">{adminDayTime(job.updatedAt, now)}</dd>
              </div>
            </dl>
            <div className="mt-2">
              <JobError job={job} />
            </div>
            <div className="mt-3">
              <JobActions
                busy={busyId === job.id}
                job={job}
                onAction={onAction}
                pending={pending}
                setPending={setPending}
              />
            </div>
          </li>
        ))
      )}
    </ul>
  );
}
