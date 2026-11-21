import { copy } from "../../../shared/copy.ts";
import type { MailHealthEmployer } from "../../lib/admin-api.ts";
import { mailPanelId } from "./mail-columns.ts";

export function MailAlertCard({
  alert,
  employer,
  open,
  pauseError,
  since,
  onPause,
  onToggle,
}: {
  alert: { companyId: string; employer: string; sent: number };
  employer: MailHealthEmployer | undefined;
  open: boolean;
  pauseError: boolean;
  since: string;
  onPause: () => void;
  onToggle: () => void;
}) {
  return (
    <section className="mt-4 rounded-lg border border-need bg-need-soft px-5 py-4">
      <h2 className="font-serif text-[19px] leading-[1.2]">
        {copy.admin.mailAlertHeading(alert.employer)}
      </h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed">
        {copy.admin.mailAlertBody(alert.sent, alert.employer, since)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button
          aria-controls={mailPanelId(alert.companyId)}
          aria-expanded={open}
          aria-label={
            open
              ? copy.admin.mailCloseEmployerFor(alert.employer)
              : copy.admin.mailOpenEmployerFor(alert.employer)
          }
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-card px-4 text-[13px] font-semibold hover:bg-muted"
          onClick={onToggle}
          type="button"
        >
          {open ? copy.admin.mailCloseEmployer : copy.admin.mailOpenEmployer}
        </button>
        <button
          aria-label={
            employer?.killSwitch?.enabled === true
              ? copy.admin.mailPausedFor(alert.employer)
              : copy.admin.mailPauseEmployerFor(alert.employer)
          }
          className="inline-flex h-10 items-center justify-center rounded-md border border-need px-4 text-[13px] font-semibold text-need hover:bg-card disabled:opacity-60"
          disabled={employer?.killSwitch?.enabled === true}
          onClick={onPause}
          type="button"
        >
          {employer?.killSwitch?.enabled === true
            ? copy.admin.mailPaused
            : copy.admin.mailPauseEmployer}
        </button>
      </div>
      {pauseError ? (
        <p className="mt-2 text-[13px] text-need" role="alert">
          {copy.admin.mailPauseFailed}
        </p>
      ) : null}
    </section>
  );
}
