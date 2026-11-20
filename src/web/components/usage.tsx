import { copy } from "../../shared/copy.ts";

export function UsageCard() {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 pb-[15px] pt-[15px]">
      <p className="mb-2.5 text-[11px] font-semibold leading-[13px] uppercase tracking-[0.15em] text-muted-foreground">
        {copy.home.applicationsLeft}
      </p>
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-[40px] leading-none tabular-nums">
          {copy.sample.applicationsLeft}
        </span>
        <span className="text-[12.5px] text-muted-foreground">{copy.sample.weekPlan}</span>
      </div>
      <div className="mt-2.5 h-[5px] rounded-[3px] bg-border">
        <div className="h-full w-[10%] rounded-[3px] bg-foreground" />
      </div>
      <p className="mt-[11px] text-xs leading-[18px] tabular-nums text-muted-foreground">
        {copy.sample.sentToday}
      </p>
    </div>
  );
}
