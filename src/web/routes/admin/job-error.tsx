import { copy } from "../../../shared/copy.ts";
import type { JobRow } from "../../lib/admin-api.ts";

export function JobError({ job }: { job: JobRow }) {
  return (
    <div className="flex max-w-[36ch] flex-col gap-1">
      <span className="break-words text-[12.5px] text-foreground">
        {job.lastError ?? copy.admin.jobsNoError}
      </span>
      <span className="break-all font-mono text-[11.5px] text-muted-foreground">
        {copy.admin.jobsPayload(job.payloadPreview)}
      </span>
    </div>
  );
}
