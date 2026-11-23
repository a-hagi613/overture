import type { JobStatus } from "../../lib/admin-api.ts";

export function canRetry(status: JobStatus) {
  return status === "dead" || status === "failed";
}

export function canCancel(status: JobStatus) {
  return status === "queued" || status === "dead";
}
