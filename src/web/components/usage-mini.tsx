import { copy } from "../../shared/copy.ts";

export function UsageMini() {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="sr-only">{copy.sample.applicationsLeftAria}</span>
      <span className="text-[11px] font-bold tabular-nums">{copy.sample.applicationsLeft}</span>
      <div className="h-1 w-9 rounded-[2px] bg-border">
        <div className="h-full w-[10%] rounded-[2px] bg-foreground" />
      </div>
    </div>
  );
}
