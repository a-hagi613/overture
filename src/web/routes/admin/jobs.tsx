import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import type { AdminResult, JobRow, JobStatusFilter, JobsResponse } from "../../lib/admin-api.ts";
import { cancelJob, jobStatusFilterSchema, loadJobs, retryJob } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { JobList } from "./job-list.tsx";
import type { PendingJobAction } from "./job-actions.tsx";
import { JobTable } from "./job-table.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminStatusCard } from "./admin-status-card.tsx";

const FILTER_ORDER = ["dead", "running", "queued", "failed", "completed", "all"] as const;

const FILTER_LABELS: Record<(typeof FILTER_ORDER)[number], string> = {
  all: copy.admin.jobsFilters.all,
  completed: copy.admin.jobsStatusDone,
  dead: copy.admin.jobsFilters.dead,
  failed: copy.admin.jobsFilters.failed,
  queued: copy.admin.jobsFilters.queued,
  running: copy.admin.jobsFilters.running,
};

const FILTER_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-md px-3.5 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

const CARD = "rounded-lg border border-border bg-card px-6 py-5 shadow-sh";

const RETRY_BUTTON =
  "mt-4 min-h-11 rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

function filterCount(counts: JobsResponse["counts"], filter: (typeof FILTER_ORDER)[number]) {
  if (filter === "all") {
    return counts.total;
  }

  return counts[filter === "completed" ? "done" : filter];
}

type JobsLoad = { kind: "jobs"; view: JobsResponse } | { kind: "failed" };

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStatus = jobStatusFilterSchema.safeParse(searchParams.get("status"));
  const status: JobStatusFilter = requestedStatus.success ? requestedStatus.data : "all";
  const kind = searchParams.get("kind") ?? "";
  const [pending, setPending] = useState<PendingJobAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await loadJobs({ kind, limit: 100, status });

      if (!result.ok) {
        return { ok: false, refusal: result.refusal } satisfies AdminResult<JobsLoad>;
      }

      return {
        data: { kind: "jobs", view: result.data },
        ok: true,
      } satisfies AdminResult<JobsLoad>;
    } catch {
      return { data: { kind: "failed" }, ok: true } satisfies AdminResult<JobsLoad>;
    }
  }, [kind, status]);

  const { data, failed, refusal, refresh } = useAdminResource<JobsLoad>(load, [
    "jobs",
    status,
    kind,
  ]);

  const updateFilter = (nextStatus: JobStatusFilter, nextKind: string) => {
    const params = new URLSearchParams(searchParams);

    if (nextStatus === "all") {
      params.delete("status");
    } else {
      params.set("status", nextStatus);
    }

    if (nextKind.length === 0) {
      params.delete("kind");
    } else {
      params.set("kind", nextKind);
    }

    setSearchParams(params, { replace: true });
  };

  const setFilter = (nextStatus: JobStatusFilter) => {
    setPending(null);
    setNotice(null);
    setActionFailed(false);
    updateFilter(nextStatus, kind);
  };

  const setKind = (nextKind: string) => {
    setPending(null);
    updateFilter(status, nextKind);
  };

  const runAction = async (job: JobRow, action: "retry" | "cancel") => {
    setBusyId(job.id);
    setActionFailed(false);

    try {
      const updated = action === "retry" ? await retryJob(job.id) : await cancelJob(job.id);

      setNotice(
        action === "retry"
          ? copy.admin.jobsRetried(updated.job.kind)
          : copy.admin.jobsCancelled(updated.job.kind),
      );
      setPending(null);
      refresh();
    } catch {
      setActionFailed(true);
    }

    setBusyId(null);
  };

  if (refusal !== null) {
    return <AdminGateScreen code={refusal} />;
  }

  const heading = (
    <AdminPageHeading
      italic={copy.admin.jobsTitleItalic}
      lead={copy.admin.jobsLead}
      plain={copy.admin.jobsTitlePlain}
    />
  );

  if (data === null) {
    return (
      <>
        {heading}
        <AdminStatusCard failed={failed} onRetry={refresh} />
      </>
    );
  }

  if (data.kind === "failed") {
    return (
      <>
        {heading}
        <section aria-labelledby="admin-jobs-failed" className={`mt-7 ${CARD}`}>
          <h2 id="admin-jobs-failed" className="font-serif text-card-title leading-[1.1]">
            {copy.admin.jobsLoadFailed}
          </h2>
          <button
            className={RETRY_BUTTON}
            onClick={() => {
              refresh();
            }}
            type="button"
          >
            {copy.admin.jobsTryAgain}
          </button>
        </section>
      </>
    );
  }

  const { view } = data;

  return (
    <>
      {heading}
      <p className="mt-2 max-w-[62ch] text-sm text-muted-foreground">{copy.admin.jobsIntro}</p>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <fieldset className="min-w-0">
          <legend className="sr-only">{copy.admin.jobsFilterLabel}</legend>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
            {FILTER_ORDER.map((filter) => {
              const selected = filter === status;

              return (
                <button
                  aria-pressed={selected}
                  className={`${FILTER_BUTTON} ${selected ? "bg-background font-semibold shadow-sh" : "text-muted-foreground"}`}
                  key={filter}
                  onClick={() => {
                    setFilter(filter);
                  }}
                  type="button"
                >
                  <span>{FILTER_LABELS[filter]}</span>
                  <span className="font-serif text-sm tabular-nums">
                    {filterCount(view.counts, filter)}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {copy.admin.jobsKindLabel}
          <select
            className="min-h-11 rounded-md border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9"
            onChange={(event) => {
              setKind(event.target.value);
            }}
            value={kind}
          >
            <option value="">{copy.admin.jobsKindAll}</option>
            {view.kinds.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-xs text-muted-foreground">
        {actionFailed ? copy.admin.jobsActionFailed : (notice ?? "")}
      </p>

      <JobList
        busyId={busyId}
        jobs={view.jobs}
        now={view.now}
        onAction={(job, action) => {
          void runAction(job, action);
        }}
        pending={pending}
        setPending={setPending}
      />
      <JobTable
        busyId={busyId}
        jobs={view.jobs}
        now={view.now}
        onAction={(job, action) => {
          void runAction(job, action);
        }}
        pending={pending}
        setPending={setPending}
      />

      <p className="mt-3 text-xs text-muted-foreground">
        {copy.admin.jobsShowing(view.jobs.length, view.total)}
      </p>
    </>
  );
}
