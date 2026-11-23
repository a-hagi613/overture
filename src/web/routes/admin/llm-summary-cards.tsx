import { copy } from "../../../shared/copy.ts";
import type { LlmUsageResponse } from "../../lib/admin-api.ts";
import { capRatioOf, formatCacheHitRate, formatTokenCount, formatUsdMicros } from "./llm-format.ts";

function monthCapHint(spentMicros: number, monthlyCapMicros: number | null) {
  if (monthlyCapMicros === null) {
    return copy.admin.llmStatMonthNoCap;
  }

  const formatted = formatUsdMicros(monthlyCapMicros);

  return spentMicros > monthlyCapMicros
    ? copy.admin.llmStatMonthOver(formatted)
    : copy.admin.llmStatMonthCap(formatted);
}

export function LlmSummaryCards({ view }: { view: LlmUsageResponse }) {
  const dailyMeter = capRatioOf(view.today.costMicros, view.caps.dailySpendCapMicros);
  const monthlyMeter = capRatioOf(view.month.costMicros, view.caps.monthlySpendCapMicros);
  const dailyCapLabel = formatUsdMicros(view.caps.dailySpendCapMicros);

  const dailyHint =
    view.today.costMicros > view.caps.dailySpendCapMicros
      ? copy.admin.llmStatTodayOver(dailyCapLabel)
      : copy.admin.llmStatTodayCap(dailyCapLabel);

  const cacheHint =
    view.allTime.inputTokens > 0
      ? copy.admin.llmStatCacheHint(
          formatTokenCount(view.allTime.cachedTokens),
          formatTokenCount(view.allTime.inputTokens),
        )
      : copy.admin.llmStatCacheEmpty;

  return (
    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sh">
        <p className="text-xs text-muted-foreground">{copy.admin.llmStatToday}</p>
        <p className="mt-1 font-serif text-metric leading-none tabular-nums">
          {formatUsdMicros(view.today.costMicros)}
        </p>
        {dailyMeter === null ? null : (
          <div
            aria-hidden="true"
            className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full rounded-full ${dailyMeter.over ? "bg-need" : "bg-foreground"}`}
              style={{ width: `${String(dailyMeter.percent)}%` }}
            />
          </div>
        )}
        <p
          className={`mt-2 text-xs ${dailyMeter?.over === true ? "font-semibold text-need" : "text-muted-foreground"}`}
        >
          {dailyHint}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sh">
        <p className="text-xs text-muted-foreground">{copy.admin.llmStatMonth}</p>
        <p className="mt-1 font-serif text-metric leading-none tabular-nums">
          {formatUsdMicros(view.month.costMicros)}
        </p>
        {monthlyMeter === null ? null : (
          <div
            aria-hidden="true"
            className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full rounded-full ${monthlyMeter.over ? "bg-need" : "bg-foreground"}`}
              style={{ width: `${String(monthlyMeter.percent)}%` }}
            />
          </div>
        )}
        <p
          className={`mt-2 text-xs ${monthlyMeter?.over === true ? "font-semibold text-need" : "text-muted-foreground"}`}
        >
          {monthCapHint(view.month.costMicros, view.caps.monthlySpendCapMicros)}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sh">
        <p className="text-xs text-muted-foreground">{copy.admin.llmStatTotal}</p>
        <p className="mt-1 font-serif text-metric leading-none tabular-nums">
          {formatUsdMicros(view.allTime.costMicros)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {copy.admin.llmStatTotalCalls(view.allTime.calls)}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sh">
        <p className="text-xs text-muted-foreground">{copy.admin.llmStatCacheHit}</p>
        <p className="mt-1 font-serif text-metric leading-none tabular-nums">
          {formatCacheHitRate(view.allTime.cachedTokens, view.allTime.inputTokens)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{cacheHint}</p>
      </div>
    </div>
  );
}
