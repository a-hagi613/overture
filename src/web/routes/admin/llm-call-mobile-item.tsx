import { copy } from "../../../shared/copy.ts";
import type { LlmUsageRow } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { formatTokenCount, formatUsdMicros, isUnexpectedModel } from "./llm-format.ts";

export function LlmCallMobileItem({
  expectedModel,
  now,
  row,
}: {
  expectedModel: string;
  now: number;
  row: LlmUsageRow;
}) {
  const unexpected = isUnexpectedModel(row.model, expectedModel);

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold">{row.purpose}</span>
        <span className="font-mono text-[13px] font-semibold tabular-nums">
          {formatUsdMicros(row.costMicros)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[12px] text-muted-foreground">
        <span>{row.model}</span>
        {unexpected ? (
          <span className="rounded-full bg-need-soft px-2 py-0.5 text-[10.5px] font-semibold text-need">
            {copy.admin.llmModelUnexpectedBadge}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 font-mono text-[12px] tabular-nums text-muted-foreground">
        {copy.admin.llmRecentTokensSummary(
          formatTokenCount(row.inputTokens),
          formatTokenCount(row.cachedTokens),
          formatTokenCount(row.outputTokens),
        )}
      </p>
      <p className="mt-1 font-mono text-[11.5px] tabular-nums text-muted-foreground">
        {adminDayTime(row.createdAt, now)}
      </p>
    </li>
  );
}
