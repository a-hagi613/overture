import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useHomeData } from "../lib/home-api.ts";
import { Card } from "./ui/card.tsx";
import { dsEyebrow, dsMetric } from "./ui/ds.ts";

function quotaAppearance(outOfCredits: boolean, lowQuota: boolean) {
  if (outOfCredits) {
    return {
      barTone: "bg-need",
      borderClass: "border-need",
      countTone: "text-need",
      footer: { label: copy.home.outOfApplications.choosePlan, toneClass: "text-need" },
    };
  }

  if (lowQuota) {
    return {
      barTone: "bg-signal",
      borderClass: "border-signal",
      countTone: "text-signal-text",
      footer: { label: copy.home.usageLowQuota, toneClass: "text-signal-text" },
    };
  }

  return {
    barTone: "bg-signal",
    borderClass: "border-border",
    countTone: "text-foreground",
    footer: null,
  };
}

export function UsageCard() {
  const { data } = useHomeData();

  const left = data?.applicationsLeft ?? 0;
  const plan = data?.planApplications ?? 0;
  const usedShare = plan > 0 ? Math.min(100, Math.max(4, ((plan - left) / plan) * 100)) : 0;
  const outOfCredits = plan > 0 && left === 0;
  const lowQuota = plan > 0 && left > 0 && left / plan < 0.25;

  const { barTone, borderClass, countTone, footer } = quotaAppearance(outOfCredits, lowQuota);

  return (
    <Card className={`bg-card p-3 ${borderClass}`}>
      <p className={dsEyebrow}>{copy.home.applicationsLeft}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={`${dsMetric} ${countTone}`}>{copy.home.usageCount(left)}</span>
        <span className="text-xs text-muted-foreground">{copy.home.usagePlan(plan)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] ${barTone}`}
          style={{ width: `${Number(usedShare.toFixed(2))}%` }}
        />
      </div>
      <div className="mt-2 flex flex-col gap-0.5 tabular-nums">
        <p className="text-xs font-medium text-foreground">
          {copy.home.usageSentTodayShort(data?.sentToday ?? 0, data?.dailyCap ?? 10)}
        </p>
        {footer === null ? (
          <p className="text-xs text-muted-foreground">{copy.home.usageResetsMidnight}</p>
        ) : (
          <Link
            className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold hover:underline ${footer.toneClass}`}
            to="/profile/billing"
          >
            <span>{footer.label}</span>
            <ArrowUpRight aria-hidden="true" size={12} />
          </Link>
        )}
      </div>
    </Card>
  );
}
