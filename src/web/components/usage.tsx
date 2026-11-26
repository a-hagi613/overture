import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { planAllowanceText } from "../../shared/plans.ts";
import { useHomeData } from "../lib/home-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";

function quotaAppearance(outOfCredits: boolean, lowQuota: boolean) {
  if (outOfCredits) {
    return { barTone: "bg-need", borderClass: "border-need", countTone: "text-need" };
  }

  if (lowQuota) {
    return { barTone: "bg-signal", borderClass: "border-signal", countTone: "text-signal-text" };
  }

  return { barTone: "bg-signal", borderClass: "border-border", countTone: "text-foreground" };
}

export function UsageCard() {
  const { data } = useHomeData();

  const left = data?.applicationsLeft ?? 0;
  const plan = data?.planApplications ?? 0;
  const planKind = data?.planKind ?? "none";
  const subscribed = planKind === "week" || planKind === "month";
  const usedShare = plan > 0 ? Math.min(100, Math.max(4, ((plan - left) / plan) * 100)) : 0;
  const outOfCredits = plan > 0 && left === 0;
  const lowQuota = plan > 0 && left > 0 && left / plan < 0.25;

  const { barTone, borderClass, countTone } = quotaAppearance(outOfCredits, lowQuota);

  return (
    <Card className={`bg-card p-3 ${borderClass}`} dataTestId="sidebar-balance">
      <div className="flex items-center justify-between gap-2">
        <p className={dsEyebrow}>{copy.home.balance.eyebrow}</p>
        {data === undefined ? (
          <span aria-hidden="true" className="h-5 w-16 animate-pulse rounded-full bg-muted" />
        ) : (
          <Badge variant="outline">{copy.home.balance.badge[planKind]}</Badge>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        <span className={`text-sm font-semibold tabular-nums ${countTone}`}>{left}</span>{" "}
        <span>{copy.home.balance.applicationsLeft}</span>{" "}
        <span className="whitespace-nowrap">
          {copy.home.balance.todayTail(data?.sentToday ?? 0, data?.dailyCap ?? 10)}
        </span>
      </p>
      {planKind === "none" ? null : (
        <p className="mt-0.5 text-xs text-muted-foreground">{planAllowanceText(planKind)}</p>
      )}
      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] ${barTone}`}
          style={{ width: `${Number(usedShare.toFixed(2))}%` }}
        />
      </div>
      <Button
        asChild
        className="mt-2.5 w-full"
        size="default"
        variant={subscribed ? "secondary" : "primary"}
      >
        <Link to="/profile/billing">
          <span>{subscribed ? copy.home.balance.manage : copy.home.balance.upgrade}</span>
          <ArrowUpRight aria-hidden="true" size={14} />
        </Link>
      </Button>
    </Card>
  );
}
