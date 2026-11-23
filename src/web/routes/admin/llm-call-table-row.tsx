import { copy } from "../../../shared/copy.ts";
import type { LlmUsageRow } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import {
  formatCacheHitRate,
  formatTokenCount,
  formatUsdMicros,
  isUnexpectedModel,
} from "./llm-format.ts";

export function LlmCallTableRow({
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
    <tr className="border-t border-border hover:bg-muted/60">
      <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
        {adminDayTime(row.createdAt, now)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs font-semibold">{row.purpose}</td>
      <td className="px-3 py-2.5">
        <span className="font-mono text-xs">{row.model}</span>
        {unexpected ? (
          <span className="ml-2 inline-flex rounded-full bg-need-soft px-2 py-0.5 text-eyebrow font-semibold text-need">
            {copy.admin.llmModelUnexpectedBadge}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
        {formatTokenCount(row.inputTokens)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
        {formatTokenCount(row.cachedTokens)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
        {formatTokenCount(row.outputTokens)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
        {formatCacheHitRate(row.cachedTokens, row.inputTokens)}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs font-semibold tabular-nums">
        {formatUsdMicros(row.costMicros)}
      </td>
    </tr>
  );
}
