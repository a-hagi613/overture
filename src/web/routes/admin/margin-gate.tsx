import { copy } from "../../../shared/copy.ts";
import type { MarginPlanRow } from "../../lib/admin-api.ts";

const GATE_TEXT = "$0.03";

export function MarginGate({ row }: { row: MarginPlanRow }) {
  if (row.costGateMet === null) {
    return null;
  }

  const className = row.costGateMet ? "bg-ok-soft text-ok" : "bg-need-soft text-need";

  const label = row.costGateMet
    ? copy.admin.marginGateUnder(GATE_TEXT)
    : copy.admin.marginGateOver(GATE_TEXT);

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
