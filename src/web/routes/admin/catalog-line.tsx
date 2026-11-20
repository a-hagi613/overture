import { copy } from "../../../shared/copy.ts";

function switchStateLabel(enabled: boolean | null) {
  if (enabled === null) {
    return copy.admin.catalogSwitchUnset;
  }

  return enabled ? copy.admin.switchOn : copy.admin.switchOff;
}

export function CatalogLine({
  ats,
  hourlyLimit,
  killState,
}: {
  ats: string;
  hourlyLimit: number | null;
  killState: boolean | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em]">{ats}</span>
      <span className="text-[12.5px] text-muted-foreground">
        {copy.admin.catalogHourlyLimit}{" "}
        <span className="font-serif text-lg tabular-nums">{hourlyLimit ?? "—"}</span>{" "}
        {copy.admin.catalogSwitchState} {switchStateLabel(killState)}
      </span>
    </div>
  );
}
