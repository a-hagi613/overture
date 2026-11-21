import { useCallback, useEffect, useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { ThemeToggle } from "../../components/theme-toggle.tsx";
import type { MailHealth } from "../../lib/admin-api.ts";
import { loadMailHealth, setKillSwitch } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { adminDay } from "../../lib/admin-date.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { MailAlertCard } from "./mail-alert-card.tsx";
import { mailColumnLayout, mailPanelId } from "./mail-columns.ts";
import { MailEmployerRow } from "./mail-employer-row.tsx";

const ranges = [
  { days: 7, label: copy.admin.mailRange7 },
  { days: 30, label: copy.admin.mailRange30 },
] as const;

export function MailHealthPage() {
  const [days, setDays] = useState<number>(30);
  const [openCompanyId, setOpenCompanyId] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);

  const load = useCallback(async () => await loadMailHealth(days), [days]);
  const { data, refusal, refresh } = useAdminResource(load);

  useEffect(() => {
    if (openCompanyId === null) {
      return;
    }

    globalThis.document
      .querySelector(`#${mailPanelId(openCompanyId)}`)
      ?.scrollIntoView({ block: "center" });
  }, [openCompanyId]);

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

  const view: MailHealth = data;

  const pauseEmployer = async (companyId: string) => {
    setPauseError(null);

    try {
      await setKillSwitch("employer", companyId, true, copy.admin.mailPauseReason);
      refresh();
    } catch {
      setPauseError(companyId);
    }
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="font-serif text-[15px] italic text-muted-foreground">
            {copy.admin.mailLead(view.days)}
          </p>
          <h1 className="mt-0.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">
            {copy.admin.mailTitlePlain} <span className="italic">{copy.admin.mailTitleItalic}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <fieldset
            aria-label={copy.admin.mailRangeLabel}
            className="m-0 inline-flex min-w-0 overflow-hidden rounded-md border border-input bg-card p-0"
          >
            {ranges.map((range) => (
              <button
                aria-pressed={days === range.days}
                className={`h-10 px-4 text-[13px] font-semibold ${
                  days === range.days
                    ? "bg-card text-foreground shadow-sh"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                key={range.days}
                onClick={() => {
                  setDays(range.days);
                  setOpenCompanyId(null);
                }}
                type="button"
              >
                {range.label}
              </button>
            ))}
          </fieldset>
          <ThemeToggle className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-input bg-card hover:bg-muted" />
        </div>
      </div>

      {view.domainAlert.active ? (
        <section className="mt-6 rounded-lg border border-need bg-need-soft px-5 py-4">
          <h2 className="font-serif text-[19px] leading-[1.2]">
            {copy.admin.mailDomainAlertHeading}
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed">
            {copy.admin.mailDomainAlertBody(view.domainAlert.sent, adminDay(view.since))}
          </p>
        </section>
      ) : null}

      {view.alerts.map((alert) => (
        <MailAlertCard
          alert={alert}
          employer={view.employers.find((row) => row.companyId === alert.companyId)}
          key={alert.companyId}
          onPause={() => {
            void pauseEmployer(alert.companyId);
          }}
          onToggle={() => {
            setOpenCompanyId(openCompanyId === alert.companyId ? null : alert.companyId);
          }}
          open={openCompanyId === alert.companyId}
          pauseError={pauseError === alert.companyId}
          since={adminDay(view.since)}
        />
      ))}

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card shadow-sh">
        <div
          className={`hidden gap-4 border-b border-border bg-muted px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid ${mailColumnLayout}`}
        >
          <span>{copy.admin.mailColumnEmployer}</span>
          <span>{copy.admin.mailColumnSent}</span>
          <span>{copy.admin.mailColumnReplies}</span>
          <span>{copy.admin.mailColumnBounces}</span>
          <span>{copy.admin.mailColumnReplyRate}</span>
          <span>{copy.admin.mailColumnStatus}</span>
        </div>
        {view.employers.length === 0 ? (
          <p className="px-5 py-8 text-[12.5px] text-muted-foreground">{copy.admin.mailEmpty}</p>
        ) : (
          view.employers.map((row) => (
            <MailEmployerRow key={row.companyId} open={openCompanyId === row.companyId} row={row} />
          ))
        )}
      </section>

      <p className="mt-4 text-[12.5px] text-muted-foreground">
        {copy.admin.mailAuthLine(
          view.totals.auth.pass,
          view.totals.auth.fail,
          view.totals.auth.none,
        )}
      </p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.admin.mailFootnote}</p>
    </>
  );
}
