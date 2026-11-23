import { copy } from "../../../shared/copy.ts";
import type { JobRow } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";

export function JobTiming({ job, now }: { job: JobRow; now: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap font-mono text-[12px]">
        {adminDayTime(job.runAt, now)}
      </span>
      {job.status === "running" && job.lockedUntil !== null ? (
        <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
          {copy.admin.jobsLockedUntil(adminDayTime(job.lockedUntil, now))}
        </span>
      ) : null}
    </div>
  );
}
