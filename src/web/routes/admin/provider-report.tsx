import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import type { ProviderReport } from "../../lib/admin-api.ts";
import { loadProviderReport, runLab } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { ReportLabRow } from "./report-lab-row.tsx";
import { ReportSendRow } from "./report-send-row.tsx";

const LAB_PROVIDERS = ["browser_use", "kernel"] as const;

const LAB_PAGES = [
  "recaptcha_v3",
  "hcaptcha",
  "turnstile",
  "form:greenhouse",
  "form:lever",
  "form:ashby",
] as const;

const inputLabelClass = "block text-[12.5px] font-semibold";

export function ProviderReportPage() {
  const { data, refusal, refresh } = useAdminResource(loadProviderReport);
  const [sessions, setSessions] = useState("1");
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
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

  const view: ProviderReport = data;

  const start = async () => {
    setNotice(null);
    setFailed(false);
    setRunning(true);

    try {
      const count = Number(sessions);

      await runLab(
        [...LAB_PROVIDERS],
        [...LAB_PAGES],
        Number.isInteger(count) && count >= 1 && count <= 200 ? count : 1,
      );

      setNotice(copy.admin.reportLabQueued);
    } catch {
      setFailed(true);
    }

    setRunning(false);
  };

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.reportTitleItalic}
        lead={copy.admin.reportLead}
        plain={copy.admin.reportTitlePlain}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          className="inline-flex min-h-11 items-center rounded-md border border-input bg-card px-3.5 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
          to="/admin/attempts"
        >
          {copy.admin.reportInspectAttempts}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center rounded-md border border-input bg-card px-3.5 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
          to="/admin/llm"
        >
          {copy.admin.reportInspectLlm}
        </Link>
      </div>
      <section aria-labelledby="admin-report-sends" className="mt-7">
        <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-report-sends">
          {copy.admin.reportSendHeading}
        </h2>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{copy.admin.reportSendIntro}</p>
        {view.providers.length === 0 ? (
          <p className="mt-4 text-[12.5px] text-muted-foreground">{copy.admin.reportSendEmpty}</p>
        ) : (
          <ul className="mt-4 flex list-none flex-col gap-3 p-0">
            {view.providers.map((row) => (
              <ReportSendRow key={`${row.provider}-${row.ats}`} row={row} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="admin-report-lab" className="mt-8">
        <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-report-lab">
          {copy.admin.reportLabHeading}
        </h2>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{copy.admin.reportLabIntro}</p>
        {view.lab.length === 0 ? (
          <p className="mt-4 text-[12.5px] text-muted-foreground">{copy.admin.reportLabEmpty}</p>
        ) : (
          <ul className="mt-4 flex list-none flex-col gap-3 p-0">
            {view.lab.map((row) => (
              <ReportLabRow key={`${row.provider}-${row.page}`} row={row} />
            ))}
          </ul>
        )}
        <div className="mt-5 rounded-lg border border-border bg-card p-[18px_20px] shadow-sh">
          <h3 className="font-serif text-[19px] leading-[1.2]">{copy.admin.reportLabRunHeading}</h3>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            {copy.admin.reportLabRunIntro}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className={inputLabelClass} htmlFor="admin-lab-sessions">
              {copy.admin.reportLabSessionsLabel}
              <input
                className="mt-1 block h-10 w-28 rounded-md border border-input bg-card px-3 text-[13px] tabular-nums"
                id="admin-lab-sessions"
                inputMode="numeric"
                max={200}
                min={1}
                onChange={(event) => {
                  setSessions(event.currentTarget.value);
                }}
                type="number"
                value={sessions}
              />
            </label>
            <button
              className="h-10 rounded-md border border-input bg-card px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-60"
              disabled={running}
              onClick={() => {
                void start();
              }}
              type="button"
            >
              {copy.admin.reportLabRun}
            </button>
          </div>
          <output aria-live="polite" className="mt-3 block text-[12.5px] text-muted-foreground">
            {failed ? copy.admin.reportLabFailed : (notice ?? "")}
          </output>
        </div>
      </section>
    </>
  );
}
