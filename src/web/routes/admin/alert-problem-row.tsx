import { copy } from "../../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import type { AdminAlertProblem } from "../../lib/admin-api.ts";

export function AlertProblemRow({ problem }: { problem: AdminAlertProblem }) {
  const isCritical = problem.severity === "critical";

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-background px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold">{problem.title}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{problem.detail}</p>
      </div>
      <Badge tone={isCritical ? "need" : "signal"}>
        {isCritical ? copy.admin.alertsSeverityCritical : copy.admin.alertsSeverityWarning}
      </Badge>
    </li>
  );
}
