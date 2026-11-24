import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { loadCatalog, loadPersonioProbe, runPersonioProbe } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { adminDay } from "../../lib/admin-date.ts";
import { AdminStatusCard } from "./admin-status-card.tsx";
import { CatalogLine } from "./catalog-line.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";

export function CatalogPage() {
  const { data, failed, refusal, refresh } = useAdminResource(loadCatalog, undefined, {
    resourceId: "catalog",
  });

  const probe = useAdminResource(loadPersonioProbe, undefined, {
    resourceId: "catalog-personio-probe",
  });

  const [queued, setQueued] = useState(false);
  const [probeRunFailed, setProbeRunFailed] = useState(false);
  const [running, setRunning] = useState(false);

  if (refusal !== null) {
    return <AdminGateScreen code={refusal} />;
  }

  const heading = (
    <AdminPageHeading
      italic={copy.admin.catalogTitleItalic}
      lead={copy.admin.catalogLead}
      plain={copy.admin.catalogTitlePlain}
    />
  );

  if (failed || data === null) {
    return (
      <>
        {heading}
        <AdminStatusCard failed={failed} onRetry={refresh} />
      </>
    );
  }

  const view = data;

  const runProbe = async () => {
    setRunning(true);
    setProbeRunFailed(false);

    try {
      await runPersonioProbe();
      setQueued(true);
      probe.refresh();
    } catch {
      setQueued(false);
      setProbeRunFailed(true);
    }

    setRunning(false);
  };

  const summary = probe.data?.summary ?? null;

  return (
    <>
      {heading}
      <section
        aria-labelledby="admin-catalog-health"
        className="mt-7 flex flex-col gap-5 rounded-lg border border-border bg-card px-6 py-5 shadow-sh"
      >
        <h2 id="admin-catalog-health" className="font-serif text-card-title leading-[1.1]">
          {copy.admin.catalogSectionHeading}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{copy.admin.catalogNotDiscovered}</p>
        <div className="mt-4">
          {view.ats.map((entry) => (
            <CatalogLine
              ats={entry.ats}
              hourlyLimit={entry.hourlyLimit}
              key={entry.ats}
              killState={entry.killSwitchEnabled}
            />
          ))}
        </div>
      </section>
      <section
        aria-labelledby="admin-personio-probe"
        className="mt-7 flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-5 shadow-sh"
      >
        <h2 id="admin-personio-probe" className="font-serif text-card-title leading-[1.1]">
          {copy.admin.catalogProbeHeading}
        </h2>
        <p className="text-xs text-muted-foreground">{copy.admin.catalogProbeLead}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="min-h-9 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sh hover:bg-muted"
            disabled={running}
            onClick={() => {
              void runProbe();
            }}
            type="button"
          >
            {copy.admin.catalogProbeRun}
          </button>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {queued ? copy.admin.catalogProbeQueued : ""}
          </span>
        </div>
        {probeRunFailed ? (
          <p className="text-xs font-semibold text-need" role="alert">
            {copy.admin.catalogProbeFailedRun}
          </p>
        ) : null}
        {probe.failed ? (
          <AdminStatusCard
            className="mt-2"
            failed
            onRetry={() => {
              probe.refresh();
            }}
          />
        ) : null}
        {probe.data === null ? null : (
          <div className="flex flex-col gap-2">
            {probe.data.ranAt === null ? (
              <p className="text-xs text-muted-foreground">{copy.admin.catalogProbeEmpty}</p>
            ) : (
              <>
                <p className="text-xs text-foreground">
                  {copy.admin.catalogProbeRanAt(adminDay(probe.data.ranAt))}
                </p>
                {summary === null ? null : (
                  <p className="text-sm font-medium text-foreground">
                    {summary.passed ? copy.admin.catalogProbePassed : copy.admin.catalogProbeFailed}
                  </p>
                )}
                {summary === null ? null : (
                  <p className="text-xs text-muted-foreground">
                    {copy.admin.catalogProbeSummary(summary)}
                  </p>
                )}
                {probe.data.forms.length === 0 ? null : (
                  <ul className="mt-1 flex flex-col divide-y divide-border">
                    {probe.data.forms.map((form) => (
                      <li
                        className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-xs"
                        key={`${form.postingId}-${String(form.index)}`}
                      >
                        <span className="min-w-0 break-all text-muted-foreground">{form.url}</span>
                        <span className="font-medium text-foreground">
                          {copy.admin.catalogProbeOutcome(form.outcome)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
