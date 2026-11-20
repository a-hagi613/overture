import { copy } from "../../../shared/copy.ts";
import type { Overview } from "../../lib/admin-api.ts";
import { loadOverview } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AuditLine } from "./audit-line.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";

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
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="admin-overview-state" className="font-serif text-[26px] leading-[1.1]">
              {copy.admin.overviewJobs}
            </h2>
            <span className="font-serif text-sm italic text-muted-foreground">
              {copy.admin.folio1}
            </span>
          </div>
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
          aria-labelledby="admin-overview-audit"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="admin-overview-audit" className="font-serif text-[26px] leading-[1.1]">
              {copy.admin.overviewAudit}
            </h2>
            <span className="font-serif text-sm italic text-muted-foreground">
              {copy.admin.folio2}
            </span>
          </div>
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
