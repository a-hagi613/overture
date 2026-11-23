import { copy } from "../../../shared/copy.ts";
import type { JobRow } from "../../lib/admin-api.ts";
import { canCancel, canRetry } from "./job-rules.ts";

export interface PendingJobAction {
  id: string;
  action: "retry" | "cancel";
}

const ACTION_BUTTON =
  "min-h-11 rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50 md:min-h-9";

export function JobActions({
  busy,
  job,
  onAction,
  pending,
  setPending,
}: {
  busy: boolean;
  job: JobRow;
  onAction: (job: JobRow, action: "retry" | "cancel") => void;
  pending: PendingJobAction | null;
  setPending: (action: PendingJobAction | null) => void;
}) {
  const confirming = pending !== null && pending.id === job.id ? pending.action : null;

  if (confirming !== null) {
    const confirmLabel =
      confirming === "retry" ? copy.admin.jobsRetryConfirm : copy.admin.jobsCancelConfirm;

    const confirmAria =
      confirming === "retry"
        ? copy.admin.jobsConfirmRetry(job.id)
        : copy.admin.jobsConfirmCancel(job.id);

    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-label={confirmAria}
          className="min-h-11 rounded-md bg-foreground px-3 text-xs font-semibold text-card disabled:opacity-50 md:min-h-9"
          disabled={busy}
          onClick={() => {
            onAction(job, confirming);
          }}
          type="button"
        >
          {confirmLabel}
        </button>
        <button
          aria-label={copy.admin.jobsKeepAria(job.id)}
          className={ACTION_BUTTON}
          disabled={busy}
          onClick={() => {
            setPending(null);
          }}
          type="button"
        >
          {copy.admin.jobsKeep}
        </button>
      </div>
    );
  }

  const retryable = canRetry(job.status);
  const cancellable = canCancel(job.status);

  return (
    <div className="flex flex-nowrap items-center gap-2">
      {retryable ? (
        <button
          aria-label={copy.admin.jobsRetryAria(job.id)}
          className={ACTION_BUTTON}
          disabled={busy}
          onClick={() => {
            setPending({ action: "retry", id: job.id });
          }}
          type="button"
        >
          {copy.admin.jobsRetry}
        </button>
      ) : null}
      {cancellable ? (
        <button
          aria-label={copy.admin.jobsCancelAria(job.id)}
          className={ACTION_BUTTON}
          disabled={busy}
          onClick={() => {
            setPending({ action: "cancel", id: job.id });
          }}
          type="button"
        >
          {copy.admin.jobsCancel}
        </button>
      ) : null}
      {retryable || cancellable ? null : (
        <span className="text-xs text-muted-foreground">{copy.admin.reportNone}</span>
      )}
    </div>
  );
}
