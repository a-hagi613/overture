import { copy } from "../../../shared/copy.ts";
import type { MarginPlanRow } from "../../lib/admin-api.ts";
import { MarginBar } from "./margin-bar.tsx";
import { MarginGate } from "./margin-gate.tsx";
import { costLabel, formatUsd, marginLabel, priceLabel } from "./margin-format.ts";

export function PlanCards({ rows }: { rows: MarginPlanRow[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sh lg:hidden">
      {rows.map((row) => (
        <li key={row.plan} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-serif text-[22px]">
              {copy.admin.marginPlanName[row.plan]}
              {copy.admin.marginSeparator}
              {priceLabel(row)}
            </h3>
            <MarginGate row={row} />
          </div>
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            {copy.admin.marginApplicationsCount(row.applications)}
          </p>
          <p className="mt-1 text-[13.5px]">
            {copy.admin.marginShortCost} {costLabel(row)}
            {copy.admin.marginSeparator}
            {copy.admin.marginShortRevenue} {formatUsd(row.revenueMicrosPerApplication, 3)}
          </p>
          <p className="mt-1 text-[13.5px]">
            {copy.admin.marginShortMargin} {marginLabel(row)}
          </p>
          <div className="mt-3">
            <MarginBar row={row} />
          </div>
        </li>
      ))}
    </ul>
  );
}
