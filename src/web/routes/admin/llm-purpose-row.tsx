import { copy } from "../../../shared/copy.ts";
import type { LlmUsagePurposeRow } from "../../lib/admin-api.ts";
import { formatCacheHitRate, formatTokenCount, formatUsdMicros } from "./llm-format.ts";

export function LlmPurposeRow({
  activePurpose,
  onSelectPurpose,
  row,
}: {
  activePurpose: string;
  onSelectPurpose: (purpose: string) => void;
  row: LlmUsagePurposeRow;
}) {
  const selected = activePurpose === row.purpose;

  return (
    <li className="border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <button
          aria-label={copy.admin.llmFilterByPurpose(row.purpose)}
          aria-pressed={selected}
          className={`min-h-11 rounded-md px-2.5 text-left font-mono text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9 ${
            selected ? "bg-foreground text-primary-ink" : "bg-card text-foreground hover:bg-muted"
          }`}
          onClick={() => {
            onSelectPurpose(selected ? "" : row.purpose);
          }}
          type="button"
        >
          {row.purpose}
        </button>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatUsdMicros(row.costMicros)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 px-2.5 font-mono text-xs tabular-nums text-muted-foreground">
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
