import { copy } from "../../../shared/copy.ts";
import type { ProviderReportRow } from "../../lib/admin-api.ts";
import { ReportMetric } from "./report-metric.tsx";

const percent = (rate: number | null) =>
  rate === null ? copy.admin.reportNone : copy.admin.reportRate(rate);

const seconds = (millis: number | null) =>
  millis === null ? copy.admin.reportNone : copy.admin.reportSeconds(millis);

const megabytes = (value: number | null) =>
  value === null ? copy.admin.reportNone : copy.admin.reportMegabytes(value);

const dollars = (micros: number | null) =>
  micros === null ? copy.admin.reportNone : copy.admin.reportDollars(micros);

function gateLabel(met: boolean | null) {
  if (met === null) {
    return copy.admin.reportNone;
  }

  return met ? copy.admin.reportCostInside : copy.admin.reportCostOver;
}

export function ReportSendRow(props: { row: ProviderReportRow }) {
  const { row } = props;

  return (
    <li className="rounded-lg border border-border bg-card p-[18px_20px] shadow-sh">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-[19px] leading-[1.2]">
          {copy.admin.reportBrowserName(row.provider)}
        </h3>
        <span className="text-[12.5px] text-muted-foreground">{row.ats}</span>
        {row.proxyTrend ? (
          <span className="rounded-full bg-need-soft px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-need">
            {copy.admin.overviewCostTrend}
          </span>
        ) : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <ReportMetric label={copy.admin.reportColumnAttempted} value={String(row.attempted)} />
        <ReportMetric label={copy.admin.reportColumnCompleted} value={String(row.sent)} />
        <ReportMetric
          label={copy.admin.reportColumnCompletion}
          value={percent(row.completionRate)}
        />
        <ReportMetric label={copy.admin.reportColumnChallenge} value={percent(row.challengeRate)} />
        <ReportMetric label={copy.admin.reportColumnCode} value={percent(row.codeRate)} />
        <ReportMetric label={copy.admin.reportColumnP50} value={seconds(row.p50BrowserMs)} />
        <ReportMetric label={copy.admin.reportColumnP95} value={seconds(row.p95BrowserMs)} />
        <ReportMetric
          label={copy.admin.reportColumnProxy}
          value={megabytes(row.proxyMbPerCompleted)}
        />
        <ReportMetric
          label={copy.admin.reportColumnCost}
          value={dollars(row.costMicrosPerCompleted)}
        />
        <ReportMetric label={copy.admin.reportColumnGate} value={gateLabel(row.costGateMet)} />
      </dl>
    </li>
  );
}
