import { copy } from "../../../shared/copy.ts";
import type { LlmUsageModelRow } from "../../lib/admin-api.ts";
import { formatCacheHitRate, formatTokenCount, formatUsdMicros } from "./llm-format.ts";

export function LlmModelRow({ row }: { row: LlmUsageModelRow }) {
  return (
    <li className="border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{row.model}</span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${
              row.unexpected ? "bg-need-soft text-need" : "bg-ok-soft text-ok"
            }`}
          >
            {row.unexpected ? copy.admin.llmModelUnexpectedBadge : copy.admin.llmModelExpectedBadge}
          </span>
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatUsdMicros(row.costMicros)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
        <span>{copy.admin.llmStatTotalCalls(row.calls)}</span>
        <span>
          {copy.admin.llmCacheHitInline(formatCacheHitRate(row.cachedTokens, row.inputTokens))}
        </span>
        <span>
          {copy.admin.llmRecentTokensSummary(
            formatTokenCount(row.inputTokens),
            formatTokenCount(row.cachedTokens),
            formatTokenCount(row.outputTokens),
          )}
        </span>
      </div>
    </li>
  );
}
