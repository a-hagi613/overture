import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useHomeData } from "../lib/home-api.ts";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";

export function UsageCard() {
  const { data } = useHomeData();

  const left = data?.applicationsLeft ?? 0;
  const plan = data?.planApplications ?? 0;
  const usedShare = plan > 0 ? Math.min(100, Math.max(4, ((plan - left) / plan) * 100)) : 0;
  const lowQuota = plan > 0 && left / plan < 0.25;

  return (
    <Card className={`bg-card p-3 ${lowQuota ? "border-signal" : "border-border"}`}>
      <p className={dsEyebrow}>{copy.home.applicationsLeft}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-serif text-metric leading-none tabular-nums text-signal-text">
          {copy.home.usageCount(left)}
        </span>
        <span className="text-xs text-muted-foreground">{copy.home.usagePlan(plan)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-signal transition-all"
          style={{ width: `${Number(usedShare.toFixed(2))}%` }}
        />
      </div>
      <div className="mt-2 flex flex-col gap-0.5 tabular-nums">
        <p className="text-xs font-medium text-foreground">
          {copy.home.usageSentTodayShort(data?.sentToday ?? 0, data?.dailyCap ?? 10)}
        </p>
        {lowQuota ? (
          <Link
            className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-signal-text hover:underline"
            to="/profile/billing"
          >
            <span>{copy.home.usageLowQuota}</span>
            <ArrowUpRight aria-hidden="true" size={12} />
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">{copy.home.usageResetsMidnight}</p>
        )}
      </div>
    </Card>
  );
}
