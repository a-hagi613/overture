import { copy } from "../../shared/copy.ts";

interface FactRowProps {
  label: string;
  value: string;
  chip: string;
  chipNote?: string;
  detail?: string;
  usedIn?: number;
}

export function FactRow(props: FactRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{props.label}</p>
        <p className="mt-1.5 font-serif text-[22px] leading-[1.1]">{props.value}</p>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-3">
          <span className="rounded-full bg-card px-3 py-1 text-[11px] font-semibold">
            {props.chip}
          </span>
          {props.chipNote !== undefined && (
            <span className="text-sm font-semibold">{props.chipNote}</span>
          )}
          {props.usedIn !== undefined && (
            <span className="text-[12.5px] text-muted-foreground">
              {copy.profile.facts.usedIn(props.usedIn)}
            </span>
          )}
        </div>
        {props.detail !== undefined && (
          <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{props.detail}</p>
        )}
      </div>
      <button
        className="h-10 flex-none rounded-md text-[13.5px] font-semibold hover:bg-muted"
        type="button"
      >
        {copy.profile.edit}
      </button>
    </div>
  );
}
