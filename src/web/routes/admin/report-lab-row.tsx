import { copy } from "../../../shared/copy.ts";
import type { LabReportRow } from "../../lib/admin-api.ts";
import { dollars, megabytes, percent, seconds } from "./report-format.ts";
import { ReportMetric } from "./report-metric.tsx";

export function ReportLabRow(props: { row: LabReportRow }) {
  const { row } = props;

  return (
    <li className="rounded-lg border border-border bg-card p-[18px_20px] shadow-sh">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-base leading-[1.2]">
          {copy.admin.reportBrowserName(row.provider)}
        </h3>
        <span className="text-xs text-muted-foreground">
          {copy.admin.reportLabPageName(row.page)}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <ReportMetric label={copy.admin.reportColumnSessions} value={String(row.sessions)} />
        <ReportMetric label={copy.admin.reportColumnCompleted} value={String(row.completed)} />
        <ReportMetric
          label={copy.admin.reportColumnCompletion}
          value={percent(row.completionRate)}
        />
        <ReportMetric label={copy.admin.reportColumnChallenge} value={percent(row.challengeRate)} />
        <ReportMetric label={copy.admin.reportColumnCode} value={percent(row.codeRate)} />
        <ReportMetric
          label={copy.admin.reportColumnScore}
          value={row.captchaScore === null ? copy.admin.reportNone : row.captchaScore.toFixed(2)}
        />
        <ReportMetric label={copy.admin.reportColumnP50} value={seconds(row.p50DurationMs)} />
        <ReportMetric label={copy.admin.reportColumnP95} value={seconds(row.p95DurationMs)} />
        <ReportMetric
          label={copy.admin.reportColumnProxy}
          value={megabytes(row.proxyMbPerCompleted)}
        />
        <ReportMetric
          label={copy.admin.reportColumnCost}
          value={dollars(row.costMicrosPerCompleted)}
        />
      </dl>
    </li>
  );
}
