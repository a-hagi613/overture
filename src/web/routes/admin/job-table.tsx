import { copy } from "../../../shared/copy.ts";
import type { JobRow } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { JobActions } from "./job-actions.tsx";
import type { PendingJobAction } from "./job-actions.tsx";
import { JobError } from "./job-error.tsx";
import { JobStatusPill } from "./job-status-pill.tsx";
import { JobTiming } from "./job-timing.tsx";

export function JobTable({
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
    <section
      aria-label={copy.admin.navJobs}
      className="mt-2 hidden overflow-x-auto rounded-lg border border-border bg-card shadow-sh md:block"
      data-scroll-region
    >
      <table
        className={`w-full border-collapse text-left text-[13px] ${jobs.length === 0 ? "" : "min-w-[900px]"}`}
      >
        <thead className="bg-muted text-[12px] text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium" scope="col">
              {copy.admin.jobsColumnJob}
            </th>
            <th className="px-4 py-2.5 font-medium" scope="col">
              {copy.admin.jobsColumnStatus}
            </th>
            <th className="px-4 py-2.5 font-medium" scope="col">
              {copy.admin.jobsColumnAttempts}
            </th>
            <th className="px-4 py-2.5 font-medium" scope="col">
              {copy.admin.jobsColumnRunAt}
            </th>
            <th className="px-4 py-2.5 font-medium" scope="col">
              {copy.admin.jobsColumnUpdated}
            </th>
            <th className="px-4 py-2.5 font-medium" scope="col">
              {copy.admin.jobsColumnError}
            </th>
            <th className="px-4 py-2.5 font-medium" scope="col">
              {copy.admin.jobsColumnActions}
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                {copy.admin.jobsEmpty}
              </td>
            </tr>
          ) : (
            jobs.map((job) => (
              <tr className="border-t border-border align-top hover:bg-muted/60" key={job.id}>
                <td className="px-4 py-3">
                  <span className="block font-semibold">{job.kind}</span>
                  <span className="mt-0.5 block break-all font-mono text-[11.5px] text-muted-foreground">
                    {job.id}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <JobStatusPill status={job.status} />
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {copy.admin.jobsAttempts(job.attempts, job.maxAttempts)}
                </td>
                <td className="px-4 py-3">
                  <JobTiming job={job} now={now} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-mono text-[12px]">
                  {adminDayTime(job.updatedAt, now)}
                </td>
                <td className="px-4 py-3">
                  <JobError job={job} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <JobActions
                    busy={busyId === job.id}
                    job={job}
                    onAction={onAction}
                    pending={pending}
                    setPending={setPending}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
