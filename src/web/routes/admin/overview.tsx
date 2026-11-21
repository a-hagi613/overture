import { copy } from "../../../shared/copy.ts";
import type { Overview } from "../../lib/admin-api.ts";
import { loadOverview } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AuditLine } from "./audit-line.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";

function gateState(cost: Overview["cost"]) {
  if (cost.completed === 0) {
    return copy.admin.overviewCostEmpty;
  }

  if (cost.costGateMet === false) {
    return copy.admin.overviewCostGateMissed;
  }

  return copy.admin.overviewCostGateMet;
}

export function OverviewPage() {
  const { data, refusal, refresh } = useAdminResource(loadOverview);

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

  const view: Overview = data;
  const jobs = Object.entries(view.jobs);

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.overviewTitleItalic}
        lead={copy.admin.overviewLead}
        plain={copy.admin.overviewTitlePlain}
      />
      <div className="mt-7 flex flex-col gap-5">
        <section
          aria-labelledby="admin-overview-state"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <h2 id="admin-overview-state" className="font-serif text-[26px] leading-[1.1]">
            {copy.admin.overviewJobs}
          </h2>
          <dl className="mt-4 flex flex-wrap gap-8">
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewUsers}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">{view.users.total}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewOwners}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">{view.users.owners}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewSessions}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">{view.sessions}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewSwitches}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">{view.killSwitches.enabled}</dd>
            </div>
          </dl>
          <div className="mt-5">
            {jobs.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">{copy.admin.overviewJobsEmpty}</p>
            ) : (
              jobs.map(([status, total]) => (
                <div
                  className="flex items-baseline justify-between gap-3 border-t border-border py-3 first:border-t-0"
                  key={status}
                >
                  <span className="font-mono text-[13px] font-semibold">{status}</span>
                  <span className="text-[12.5px] text-muted-foreground">
                    <span className="font-serif text-lg tabular-nums">{total}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
        <section
          aria-labelledby="admin-overview-cost"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <h2 id="admin-overview-cost" className="font-serif text-[26px] leading-[1.1]">
            {copy.admin.overviewCost}
          </h2>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{copy.admin.overviewCostIntro}</p>
          <dl className="mt-4 flex flex-wrap gap-8">
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewCostCompleted}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">{view.cost.completed}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewCostProxy}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">
                {view.cost.proxyMbPerCompleted === null
                  ? "—"
                  : `${view.cost.proxyMbPerCompleted.toFixed(2)} MB`}
              </dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewCostPerApplication}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">
                {view.cost.costMicrosPerCompleted === null
                  ? "—"
                  : copy.admin.overviewCostGate(
                      `$${(view.cost.costMicrosPerCompleted / 1_000_000).toFixed(4)}`,
                      `$${(view.cost.costGateMicros / 1_000_000).toFixed(2)}`,
                    )}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[12.5px] text-muted-foreground">{gateState(view.cost)}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {view.cost.proxyTrend ? copy.admin.overviewCostTrend : copy.admin.overviewCostNoTrend}
          </p>
        </section>
        <section
          aria-labelledby="admin-overview-mail"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="admin-overview-mail" className="font-serif text-[26px] leading-[1.1]">
              {copy.admin.overviewMail}
            </h2>
            <span className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
              {view.mail.month}
            </span>
          </div>
          <dl className="mt-4 flex flex-wrap gap-8">
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewMailSent}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">
                {view.mail.total.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewMailCap}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">
                {view.mail.cap.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.admin.overviewMailReserve}
              </dt>
              <dd className="font-serif text-3xl tabular-nums">
                {view.mail.reserve.toLocaleString("en-US")}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[12.5px] text-muted-foreground">
            {copy.admin.overviewMailNote(view.mail.cap, view.mail.reserve)}
          </p>
          {view.mail.refusedAt === null ? null : (
            <p className="mt-1 text-[12.5px] font-semibold text-foreground">
              {copy.admin.overviewMailRefused}
            </p>
          )}
          {view.mail.refusedAt !== null || view.mail.reserveRefusedAt === null ? null : (
            <p className="mt-1 text-[12.5px] font-semibold text-foreground">
              {copy.admin.overviewMailReservePaused}
            </p>
          )}
        </section>
        <section
          aria-labelledby="admin-overview-audit"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <h2 id="admin-overview-audit" className="font-serif text-[26px] leading-[1.1]">
            {copy.admin.overviewAudit}
          </h2>
          <div className="mt-4">
            {view.audit.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">{copy.admin.overviewAuditEmpty}</p>
            ) : (
              view.audit.map((row) => <AuditLine key={row.id} row={row} />)
            )}
          </div>
        </section>
      </div>
    </>
  );
}
