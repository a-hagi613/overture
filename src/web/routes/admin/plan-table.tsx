import { copy } from "../../../shared/copy.ts";
import type { MarginPlanRow } from "../../lib/admin-api.ts";
import { MarginBar } from "./margin-bar.tsx";
import { MarginGate } from "./margin-gate.tsx";
import { costLabel, formatUsd, marginLabel, priceLabel } from "./margin-format.ts";

export function PlanTable({ rows }: { rows: MarginPlanRow[] }) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow-sh lg:block">
      <table className="w-full text-left text-sm">
        <thead className="bg-sidebar text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-5 py-4 font-normal">
              {copy.admin.marginColumnPlan}
            </th>
            <th scope="col" className="px-4 py-4 font-normal">
              {copy.admin.marginColumnPrice}
            </th>
            <th scope="col" className="px-4 py-4 font-normal">
              {copy.admin.marginColumnApplications}
            </th>
            <th scope="col" className="px-4 py-4 font-normal">
              {copy.admin.marginColumnCost}
            </th>
            <th scope="col" className="px-4 py-4 font-normal">
              {copy.admin.marginColumnRevenue}
            </th>
            <th scope="col" className="px-4 py-4 font-normal">
              {copy.admin.marginColumnMargin}
            </th>
            <th scope="col" className="px-4 py-4 font-normal">
              {copy.admin.marginColumnGate}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.plan} className="border-t border-border hover:bg-muted/40">
              <th scope="row" className="px-5 py-5 text-left font-medium">
                {copy.admin.marginPlanName[row.plan]}
              </th>
              <td className="px-4 py-5 tabular-nums">{priceLabel(row)}</td>
              <td className="px-4 py-5 tabular-nums">{row.applications}</td>
              <td className="px-4 py-5 tabular-nums">{costLabel(row)}</td>
              <td className="px-4 py-5 tabular-nums">
                {formatUsd(row.netRevenueMicrosPerApplication, 3)}
              </td>
              <td className="px-4 py-5 tabular-nums">{marginLabel(row)}</td>
              <td className="px-4 py-5">
                <div className="flex flex-col gap-2">
                  <MarginBar row={row} />
                  <MarginGate row={row} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
