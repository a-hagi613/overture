import { copy } from "../../../shared/copy.ts";
import type { MarginPlanRow } from "../../lib/admin-api.ts";

/**
 * Formats micros (millionths of a dollar) as dollars, with a true minus sign.
 * @param micros The amount in micros.
 * @param decimals How many decimal places to show.
 * @returns The formatted dollar amount.
 */
export function formatUsd(micros: number, decimals: number) {
  const dollars = Math.abs(micros) / 1_000_000;
  const text = `$${dollars.toFixed(decimals)}`;

  return micros < 0 ? `−${text}` : text;
}

/**
 * Formats a ratio as a whole percentage.
 * @param ratio The ratio, where 1 is 100 %.
 * @returns The percentage text.
 */
export function formatPercent(ratio: number) {
  return `${String(Math.round(ratio * 100))}%`;
}

export function costLabel(row: MarginPlanRow) {
  return row.costMicrosPerCompleted === null
    ? copy.admin.marginNotMeasured
    : formatUsd(row.costMicrosPerCompleted, 3);
}

export function marginLabel(row: MarginPlanRow) {
  return row.marginMicrosPerApplication === null
    ? copy.admin.marginNotMeasured
    : formatUsd(row.marginMicrosPerApplication, 3);
}
