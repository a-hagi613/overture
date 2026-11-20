import { copy } from "../../shared/copy.ts";
import { useHomeData } from "../lib/home-api.ts";

export function UsageCard() {
  const { data } = useHomeData();

  const left = data?.applicationsLeft ?? 0;
  const plan = data?.planApplications ?? 0;
  const usedShare = plan > 0 ? ((plan - left) / plan) * 100 : 0;

  return (
    <div className="rounded-lg border border-border bg-card px-3.5 pb-[15px] pt-[15px]">
      <p className="mb-2.5 text-[11px] font-semibold leading-[13px] uppercase tracking-[0.15em] text-muted-foreground">
        {copy.home.applicationsLeft}
      </p>
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-[40px] leading-none tabular-nums">
          {copy.home.usageCount(left)}
        </span>
        <span className="text-[12.5px] text-muted-foreground">{copy.home.usagePlan(plan)}</span>
      </div>
      <div className="mt-2.5 h-[5px] rounded-[3px] bg-border">
        <div
          className="h-full rounded-[3px] bg-foreground"
          style={{ width: `${Number(usedShare.toFixed(3))}%` }}
        />
      </div>
      <p className="mt-[11px] text-xs leading-[18px] tabular-nums text-muted-foreground">
        {copy.home.usageSentToday(data?.sentToday ?? 0, data?.dailyCap ?? 10)}
      </p>
    </div>
  );
}
