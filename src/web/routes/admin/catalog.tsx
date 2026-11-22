import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { loadCatalog, loadPersonioProbe, runPersonioProbe } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { adminDay } from "../../lib/admin-date.ts";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { CatalogLine } from "./catalog-line.tsx";

export function CatalogPage() {
  const { data, refusal, refresh } = useAdminResource(loadCatalog);
  const probe = useAdminResource(loadPersonioProbe);
  const [queued, setQueued] = useState(false);
  const [running, setRunning] = useState(false);

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

  const view = data;

  const runProbe = async () => {
    setRunning(true);

    await runPersonioProbe()
      .then(() => {
        setQueued(true);
        probe.refresh();

        return true;
      })
      .catch(() => undefined)
      .finally(() => {
        setRunning(false);
      });
  };

  const summary = probe.data?.summary ?? null;

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.catalogTitleItalic}
        lead={copy.admin.catalogLead}
        plain={copy.admin.catalogTitlePlain}
      />
      <section
        aria-labelledby="admin-catalog-health"
        className="mt-7 flex flex-col gap-5 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      >
        <h2 id="admin-catalog-health" className="font-serif text-[26px] leading-[1.1]">
          {copy.admin.catalogSectionHeading}
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {copy.admin.catalogNotDiscovered}
        </p>
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
        className="mt-7 flex flex-col gap-4 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      >
        <h2 id="admin-personio-probe" className="font-serif text-[26px] leading-[1.1]">
          {copy.admin.catalogProbeHeading}
        </h2>
        <p className="text-[12.5px] text-muted-foreground">{copy.admin.catalogProbeLead}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="min-h-9 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground shadow-sh hover:bg-muted"
            disabled={running}
            onClick={() => {
              void runProbe();
            }}
            type="button"
          >
            {copy.admin.catalogProbeRun}
          </button>
          <span aria-live="polite" className="text-[12.5px] text-muted-foreground">
            {queued ? copy.admin.catalogProbeQueued : ""}
          </span>
        </div>
        {probe.data === null ? null : (
          <div className="flex flex-col gap-2">
            {probe.data.ranAt === null ? (
              <p className="text-[12.5px] text-muted-foreground">{copy.admin.catalogProbeEmpty}</p>
            ) : (
              <>
                <p className="text-[12.5px] text-foreground">
                  {copy.admin.catalogProbeRanAt(adminDay(probe.data.ranAt))}
                </p>
                {summary === null ? null : (
                  <p className="text-[13px] font-medium text-foreground">
                    {summary.passed ? copy.admin.catalogProbePassed : copy.admin.catalogProbeFailed}
                  </p>
                )}
                {summary === null ? null : (
                  <p className="text-[12.5px] text-muted-foreground">
                    {copy.admin.catalogProbeSummary(summary)}
                  </p>
                )}
                {probe.data.forms.length === 0 ? null : (
                  <ul className="mt-1 flex flex-col divide-y divide-border">
                    {probe.data.forms.map((form) => (
                      <li
                        className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[12.5px]"
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
