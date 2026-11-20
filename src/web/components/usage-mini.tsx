import { copy } from "../../shared/copy.ts";
import { useHomeData } from "../lib/home-api.ts";

export function UsageMini() {
  const { data } = useHomeData();

  const left = data?.applicationsLeft ?? 0;
  const plan = data?.planApplications ?? 0;
  const usedShare = plan > 0 ? ((plan - left) / plan) * 100 : 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="sr-only">{copy.home.usageAria(left)}</span>
      <span className="text-[11px] font-bold tabular-nums">{copy.home.usageCount(left)}</span>
      <div className="h-1 w-9 rounded-[2px] bg-border">
        <div
          className="h-full rounded-[2px] bg-foreground"
          style={{ width: `${Number(usedShare.toFixed(3))}%` }}
        />
      </div>
    </div>
  );
}
