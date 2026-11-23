import { copy } from "../../../shared/copy.ts";
import type { MarginPlanRow } from "../../lib/admin-api.ts";
import { formatPercent } from "./margin-format.ts";

export function MarginBar({ row }: { row: MarginPlanRow }) {
  const ratio = row.marginRatio;

  if (ratio === null) {
    return (
      <div className="flex items-center gap-3">
        <div className="h-2 w-[120px] rounded-full bg-muted" aria-hidden="true" />
        <span className="text-sm">{copy.admin.marginNotMeasured}</span>
      </div>
    );
  }

  const width = Math.max(0, Math.min(1, ratio)) * 100;

  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-[120px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${String(width)}%` }} />
      </div>
      <span className="text-sm tabular-nums">{formatPercent(ratio)}</span>
    </div>
  );
}
