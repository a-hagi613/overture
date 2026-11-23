import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import type { SystemReport } from "../../lib/admin-api.ts";
import { runLiveChecksNow } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { systemButtonClass } from "./system-classes.ts";
import { SystemLiveCheckRow } from "./system-live-check-row.tsx";

export function SystemLiveChecksCard({
  refresh,
  view,
}: {
  refresh: () => void;
  view: SystemReport;
}) {
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const now = view.generatedAt;

  const runChecks = async () => {
    setRunning(true);
    setFailed(false);
    setNote(null);

    try {
      await runLiveChecksNow();
      setNote(copy.admin.systemLiveChecksQueued);
      refresh();
    } catch {
      setFailed(true);
    }

    setRunning(false);
  };

  return (
    <section
      aria-labelledby="admin-system-live-checks"
      className="rounded-lg border border-border bg-card px-6 py-5 shadow-sh"
    >
      <h2 className="font-serif text-card-title leading-[1.1]" id="admin-system-live-checks">
        {copy.admin.systemLiveChecksHeading}
      </h2>
      <p className="mt-1.5 max-w-[640px] text-xs text-muted-foreground">
        {copy.admin.systemLiveChecksIntro}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className={systemButtonClass}
          disabled={running}
          onClick={() => {
            void runChecks();
          }}
          type="button"
        >
          {running ? copy.admin.systemLiveChecksRunning : copy.admin.systemLiveChecksRun}
        </button>
        <span className="text-xs text-muted-foreground">
          {view.liveChecks.latestRunAt === null
            ? ""
            : copy.admin.systemLiveChecksLastRun(adminDayTime(view.liveChecks.latestRunAt, now))}
        </span>
        <output aria-live="polite" className="text-xs text-muted-foreground">
          {failed ? copy.admin.systemLiveChecksFailed : (note ?? "")}
        </output>
      </div>
      {view.liveChecks.results.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">{copy.admin.systemLiveChecksEmpty}</p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-lg border border-border">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_90px_100px_140px_minmax(0,1.3fr)] gap-4 border-b border-border bg-muted px-5 py-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
            <span>{copy.admin.systemColumnCheck}</span>
            <span>{copy.admin.systemColumnResult}</span>
            <span>{copy.admin.systemColumnLatency}</span>
            <span>{copy.admin.systemColumnWhen}</span>
            <span>{copy.admin.systemColumnDetail}</span>
          </div>
          <ul className="list-none p-0">
            {view.liveChecks.results.map((result) => (
              <SystemLiveCheckRow key={result.id} now={now} result={result} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
