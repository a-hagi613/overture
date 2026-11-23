import { useCallback, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import {
  attemptOutcomeFilterSchema,
  fetchAdminAttemptLive,
  fetchAdminAttemptReplay,
  fetchAdminAttempts,
} from "../../lib/admin-api.ts";
import type { AttemptOutcomeFilter, AttemptRow } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AttemptInspectPanel } from "./attempt-inspect-panel.tsx";
import type { AttemptInspectState } from "./attempt-inspect-panel.tsx";
import { AttemptMobileItem } from "./attempt-mobile-item.tsx";
import { ATTEMPT_OUTCOME_FILTER_ORDER, attemptFilterLabel } from "./attempts-format.ts";
import { AttemptsTable } from "./attempts-table.tsx";
import { BillingStatCard } from "./billing-stat-card.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";

const FILTER_BUTTON_CLASS =
  "min-h-11 rounded-md px-3.5 text-[13px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9";

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md border border-input bg-card px-3.5 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9";

function parseOutcomeFilter(raw: string | null) {
  const parsed = attemptOutcomeFilterSchema.safeParse(raw);
  const outcome: AttemptOutcomeFilter = parsed.success ? parsed.data : "all";

  return outcome;
}

export function AttemptsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const outcome = parseOutcomeFilter(searchParams.get("outcome"));
  const applicationId = searchParams.get("applicationId") ?? "";
  const [inspect, setInspect] = useState<AttemptInspectState | null>(null);
  const inspectSeq = useRef(0);
  const applicationInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async () =>
      await fetchAdminAttempts({
        applicationId: applicationId.length > 0 ? applicationId : undefined,
        outcome,
      }),
    [applicationId, outcome],
  );

  const { data, refusal, refresh } = useAdminResource(load);

  if (refusal !== null) {
    return (
      <AdminGateScreen
        code={refusal}
        onPasskeyDone={() => {
          refresh();
        }}
      />
    );
  }

  if (data === null) {
    return null;
  }

  const updateFilters = (nextOutcome: AttemptOutcomeFilter, nextApplicationId: string) => {
    const next = new URLSearchParams();
    const trimmed = nextApplicationId.trim();

    if (nextOutcome !== "all") {
      next.set("outcome", nextOutcome);
    }

    if (trimmed.length > 0) {
      next.set("applicationId", trimmed);
    }

    setSearchParams(next, { replace: true });
    inspectSeq.current += 1;
    setInspect(null);
  };

  const inspectLive = async (attempt: AttemptRow) => {
    inspectSeq.current += 1;
    const requestId = inspectSeq.current;

    setInspect({ attempt, kind: "live", status: "loading" });

    try {
      const result = await fetchAdminAttemptLive(attempt.id);

      if (inspectSeq.current !== requestId) {
        return;
      }

      if (result.ok) {
        setInspect({ attempt, data: result.data, kind: "live", status: "ready" });
      } else if ("unavailable" in result) {
        setInspect({ attempt, kind: "live", status: "unavailable" });
      } else {
        refresh();
      }
    } catch {
      if (inspectSeq.current === requestId) {
        setInspect({ attempt, kind: "live", status: "error" });
      }
    }
  };

  const inspectReplay = async (attempt: AttemptRow) => {
    inspectSeq.current += 1;
    const requestId = inspectSeq.current;

    setInspect({ attempt, kind: "replay", status: "loading" });

    try {
      const result = await fetchAdminAttemptReplay(attempt.id);

      if (inspectSeq.current !== requestId) {
        return;
      }

      if (result.ok) {
        setInspect({ attempt, data: result.data, kind: "replay", status: "ready" });
      } else if ("unavailable" in result) {
        setInspect({ attempt, kind: "replay", status: "unavailable" });
      } else {
        refresh();
      }
    } catch {
      if (inspectSeq.current === requestId) {
        setInspect({ attempt, kind: "replay", status: "error" });
      }
    }
  };

  const blockedOrFailed = data.counts.challenge_blocked + data.counts.error + data.counts.timeout;

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.attemptsTitleItalic}
        lead={copy.admin.attemptsLead}
        plain={copy.admin.attemptsTitlePlain}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Link className={NAV_LINK_CLASS} to="/admin/provider-report">
          {copy.admin.attemptsBackToReport}
        </Link>
        <Link className={NAV_LINK_CLASS} to="/admin/llm">
          {copy.admin.reportInspectLlm}
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BillingStatCard
          hint={copy.admin.attemptsSummaryTotalHint}
          label={copy.admin.attemptsSummaryTotal}
          value={data.counts.all}
        />
        <BillingStatCard
          hint={copy.admin.attemptsSummaryActiveHint}
          label={copy.admin.attemptsSummaryActive}
          value={data.counts.active}
        />
        <BillingStatCard
          hint={copy.admin.attemptsSummaryCompletedHint}
          label={copy.admin.attemptsSummaryCompleted}
          value={data.counts.completed}
        />
        <BillingStatCard
          hint={copy.admin.attemptsSummaryBlockedHint}
          label={copy.admin.attemptsSummaryBlocked}
          value={blockedOrFailed}
        />
      </div>

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <fieldset
          aria-label={copy.admin.attemptsFilterOutcomeLabel}
          className="m-0 inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
        >
          {ATTEMPT_OUTCOME_FILTER_ORDER.map((filter) => {
            const selected = filter === outcome;

            return (
              <button
                aria-pressed={selected}
                className={`${FILTER_BUTTON_CLASS} ${selected ? "bg-background font-semibold shadow-sh" : "text-muted-foreground"}`}
                key={filter}
                onClick={() => {
                  updateFilters(filter, applicationId);
                }}
                type="button"
              >
                {attemptFilterLabel(filter, data.counts)}
              </button>
            );
          })}
        </fieldset>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            updateFilters(outcome, applicationInput.current?.value ?? "");
          }}
        >
          <label className="block text-[12px] font-semibold" htmlFor="admin-attempts-app-id">
            {copy.admin.attemptsApplicationFilterLabel}
            <input
              className="mt-1 block h-11 w-full min-w-[200px] rounded-md border border-input bg-card px-3 font-mono text-[13px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground sm:w-64 md:h-10"
              defaultValue={applicationId}
              id="admin-attempts-app-id"
              key={applicationId}
              name="applicationId"
              placeholder={copy.admin.attemptsApplicationFilterPlaceholder}
              ref={applicationInput}
              type="search"
            />
          </label>
          <button
            className="min-h-11 rounded-md border border-foreground bg-foreground px-4 text-[13px] font-semibold text-primary-ink hover:bg-btn-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-10"
            type="submit"
          >
            {copy.admin.attemptsApplicationFilterApply}
          </button>
          {applicationId.length > 0 ? (
            <button
              className="min-h-11 rounded-md border border-input bg-card px-3.5 text-[13px] font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-10"
              onClick={() => {
                updateFilters(outcome, "");
              }}
              type="button"
            >
              {copy.admin.attemptsApplicationFilterClear}
            </button>
          ) : null}
        </form>
      </div>

      {inspect === null ? null : (
        <AttemptInspectPanel
          onClose={() => {
            inspectSeq.current += 1;
            setInspect(null);
          }}
          state={inspect}
        />
      )}

      <ul
        aria-label={copy.admin.attemptsListLabel}
        className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sh md:hidden"
      >
        {data.attempts.length === 0 ? (
          <li className="px-4 py-6 text-[13px] text-muted-foreground">
            {copy.admin.attemptsEmpty}
          </li>
        ) : (
          data.attempts.map((attempt) => (
            <AttemptMobileItem
              attempt={attempt}
              key={attempt.id}
              now={data.now}
              onFilterApplication={(nextId) => {
                updateFilters(outcome, nextId);
              }}
              onInspectLive={(target) => {
                void inspectLive(target);
              }}
              onInspectReplay={(target) => {
                void inspectReplay(target);
              }}
            />
          ))
        )}
      </ul>

      <AttemptsTable
        attempts={data.attempts}
        now={data.now}
        onFilterApplication={(nextId) => {
          updateFilters(outcome, nextId);
        }}
        onInspectLive={(target) => {
          void inspectLive(target);
        }}
        onInspectReplay={(target) => {
          void inspectReplay(target);
        }}
      />
    </>
  );
}
