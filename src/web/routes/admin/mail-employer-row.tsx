import { copy } from "../../../shared/copy.ts";
import type { MailHealthEmployer } from "../../lib/admin-api.ts";
import { AdminCellLabel } from "./cell-label.tsx";
import { mailColumnLayout, mailPanelId } from "./mail-columns.ts";

function statusTone(status: MailHealthEmployer["status"]) {
  if (status === "reply_alert") {
    return "bg-need-soft text-need";
  }

  if (status === "watch") {
    return "bg-signal-soft text-signal-text";
  }

  return status === "healthy" ? "bg-ok-soft text-ok" : "bg-muted text-muted-foreground";
}

function statusLabel(row: MailHealthEmployer) {
  if (row.status === "reply_alert") {
    return copy.admin.mailStatusReplyAlert;
  }

  if (row.status === "watch") {
    return copy.admin.mailStatusWatch(row.bounces);
  }

  return row.status === "healthy" ? copy.admin.mailStatusHealthy : copy.admin.mailStatusTooFewSends;
}

function rateText(row: MailHealthEmployer) {
  return row.replyRate === null
    ? copy.admin.mailReplyRateNone
    : copy.admin.mailReplyRate(Math.round(row.replyRate * 100));
}

export function MailEmployerRow({ open, row }: { open: boolean; row: MailHealthEmployer }) {
  return (
    <div className="border-t border-border">
      <div
        className={`block px-5 py-4 md:grid md:items-center md:gap-4 md:py-3.5 ${mailColumnLayout}`}
      >
        <div className="min-w-0">
          <AdminCellLabel label={copy.admin.mailColumnEmployer} />
          <p className="truncate text-sm font-semibold">{row.employer}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="sr-only">{copy.admin.mailColumnAts} </span>
            {copy.admin.mailAtsList(row.ats)}
          </p>
        </div>
        <div className="mt-3 md:mt-0">
          <AdminCellLabel label={copy.admin.mailColumnSent} />
          <span className="text-sm tabular-nums">{row.sent}</span>
        </div>
        <div className="mt-3 md:mt-0">
          <AdminCellLabel label={copy.admin.mailColumnReplies} />
          <span className="text-sm tabular-nums">{row.replies}</span>
        </div>
        <div className="mt-3 md:mt-0">
          <AdminCellLabel label={copy.admin.mailColumnBounces} />
          <span className="text-sm tabular-nums">{row.bounces}</span>
        </div>
        <div className="mt-3 md:mt-0">
          <AdminCellLabel label={copy.admin.mailColumnReplyRate} />
          <span className="text-sm tabular-nums">{rateText(row)}</span>
        </div>
        <div className="mt-3 md:mt-0">
          <AdminCellLabel label={copy.admin.mailColumnStatus} />
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${statusTone(row.status)}`}
          >
            {statusLabel(row)}
          </span>
        </div>
      </div>
      <div
        className="border-t border-border bg-muted/40 px-5 py-4"
        hidden={!open}
        id={mailPanelId(row.companyId)}
      >
        <p className="text-sm">{copy.admin.mailExpandedApplications(row.applications)}</p>
        <p className="mt-1 text-sm">
          {copy.admin.mailAuthLine(row.auth.pass, row.auth.fail, row.auth.none)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {row.killSwitch === null
            ? copy.admin.mailExpandedSwitchOff
            : copy.admin.mailExpandedSwitchOn(row.killSwitch.reason)}
        </p>
      </div>
    </div>
  );
}
