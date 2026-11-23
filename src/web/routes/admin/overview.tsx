import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { CardHeader } from "./ui/card-header.tsx";
import { CardTitle } from "./ui/card-title.tsx";
import { Card } from "./ui/card.tsx";
import type { Overview } from "../../lib/admin-api.ts";
import { loadAdminAlerts, loadOverview } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { ActiveAlertsCard } from "./active-alerts-card.tsx";
import { AdminStatusCard } from "./admin-status-card.tsx";
import { AuditLine } from "./audit-line.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { LaunchReadinessCard } from "./launch-readiness-card.tsx";
import { AdminPageHeading } from "./page-heading.tsx";

function gateState(cost: Overview["cost"]) {
  if (cost.completed === 0) {
    return copy.admin.overviewCostEmpty;
  }

  if (cost.costGateMet === false) {
    return copy.admin.overviewCostGateMissed;
  }

  return copy.admin.overviewCostGateMet;
}

function mailStopNote(mail: Overview["mail"]) {
  if (mail.refusedAt !== null) {
    return copy.admin.overviewMailRefused;
  }

  return mail.reserveRefusedAt === null ? null : copy.admin.overviewMailReservePaused;
}

export function OverviewPage() {
  const overview = useAdminResource(loadOverview, ["overview"]);
  const alerts = useAdminResource(loadAdminAlerts, ["alerts"]);

  const refusal = overview.refusal ?? alerts.refusal;

  if (refusal !== null) {
    return (
      <AdminGateScreen
        code={refusal}
        onPasskeyDone={() => {
          overview.refresh();
          alerts.refresh();
        }}
      />
    );
  }

  const heading = (
    <AdminPageHeading
      italic={copy.admin.overviewTitleItalic}
      lead={copy.admin.overviewLead}
      plain={copy.admin.overviewTitlePlain}
    />
  );

  if (overview.failed || overview.data === null) {
    return (
      <>
        {heading}
        <AdminStatusCard
          failed={overview.failed}
          onRetry={() => {
            overview.refresh();
            alerts.refresh();
          }}
        />
      </>
    );
  }

  const view: Overview = overview.data;
  const jobs = Object.entries(view.jobs);
  const deadJobs = view.jobs.dead ?? 0;
  const mailStop = mailStopNote(view.mail);

  return (
    <>
      {heading}
      <div className="mt-7 flex flex-col gap-5">
        {view.openSupportTickets > 0 ? (
          <p>
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border border-signal bg-signal-soft px-3.5 text-[13px] font-semibold text-signal-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9"
              to="/admin/support?status=open"
            >
              {copy.admin.overviewSupportOpen(view.openSupportTickets)}
            </Link>
          </p>
        ) : null}
        {alerts.failed ? (
          <AdminStatusCard
            className=""
            failed
            onRetry={() => {
              alerts.refresh();
            }}
          />
        ) : null}
        {alerts.data === null ? null : (
          <div className="grid gap-5 lg:grid-cols-2">
            <ActiveAlertsCard alerts={alerts.data} />
            <LaunchReadinessCard readiness={alerts.data.readiness} />
          </div>
        )}
        <Card ariaLabelledBy="admin-overview-state">
          <CardTitle id="admin-overview-state">{copy.admin.overviewJobs}</CardTitle>
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
          {deadJobs > 0 ? (
            <p className="mt-3">
              <Link
                className="inline-flex min-h-11 items-center rounded-sm text-[12.5px] font-semibold text-signal-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9"
                to="/admin/jobs?status=dead"
              >
                {copy.admin.overviewJobsDead(deadJobs)}
              </Link>
            </p>
          ) : null}
        </Card>
        <Card ariaLabelledBy="admin-overview-cost">
          <CardTitle id="admin-overview-cost">{copy.admin.overviewCost}</CardTitle>
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
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-md border border-input bg-card px-3.5 text-[12.5px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
              to="/admin/provider-report"
            >
              {copy.admin.overviewOpenReport}
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-md border border-input bg-card px-3.5 text-[12.5px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
              to="/admin/attempts"
            >
              {copy.admin.overviewInspectAttempts}
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-md border border-input bg-card px-3.5 text-[12.5px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
              to="/admin/llm"
            >
              {copy.admin.overviewInspectLlm}
            </Link>
          </div>
        </Card>
        <Card ariaLabelledBy="admin-overview-mail">
          <CardHeader>
            <CardTitle id="admin-overview-mail">{copy.admin.overviewMail}</CardTitle>
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {view.mail.month}
            </span>
          </CardHeader>
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
          {mailStop === null ? null : (
            <p className="mt-1 text-[12.5px] font-semibold text-foreground">{mailStop}</p>
          )}
        </Card>
        <Card ariaLabelledBy="admin-overview-audit">
          <CardHeader>
            <CardTitle id="admin-overview-audit">{copy.admin.overviewAudit}</CardTitle>
            <Link
              className="inline-flex min-h-11 items-center rounded-md px-2.5 text-[13px] font-semibold underline underline-offset-2 hover:bg-muted md:min-h-9"
              to="/admin/audit"
            >
              {copy.admin.overviewAuditAll}
            </Link>
          </CardHeader>
          <div className="mt-4">
            {view.audit.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">{copy.admin.overviewAuditEmpty}</p>
            ) : (
              view.audit.map((row) => <AuditLine key={row.id} row={row} />)
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
