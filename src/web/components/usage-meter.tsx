import { copy } from "../../shared/copy.ts";

export function UsageMeter({ wide }: { wide: boolean }) {
  if (!wide) {
    return (
      <div className="hidden md:flex md:flex-col md:items-center md:gap-1">
        <span className="text-[11px] font-bold tabular-nums">{copy.shell.usage.left}</span>
        <div className="h-1 w-9 rounded-sm bg-border">
          <div className="h-full w-[10%] rounded-sm bg-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card pb-[15px] pl-3.5 pr-3.5 pt-3.5">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[.15em] leading-[normal] text-muted-foreground">
        {copy.shell.usage.label}
      </p>
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-[40px] leading-none tabular-nums">
          {copy.shell.usage.left}
        </span>
        <span className="text-[12.5px] text-muted-foreground">{copy.shell.usage.weekPlan}</span>
      </div>
      <div className="mt-2.5 h-[5px] rounded-[3px] bg-border">
        <div className="h-full w-[10%] rounded-[3px] bg-foreground" />
      </div>
      <p className="mt-[11px] text-xs leading-[18px] text-muted-foreground tabular-nums">
        {copy.shell.usage.today}
      </p>
    </div>
  );
}
