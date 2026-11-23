import { Badge } from "./ui/badge.tsx";
import type { BadgeTone } from "./ui/badge.tsx";

export function ReadinessRow({
  badgeLabel,
  badgeTone,
  detail,
  label,
}: {
  badgeLabel: string;
  badgeTone: BadgeTone;
  detail?: string | undefined;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {detail === undefined ? null : (
          <p className="font-mono text-xs text-muted-foreground tabular-nums">{detail}</p>
        )}
      </div>
      <Badge tone={badgeTone}>{badgeLabel}</Badge>
    </div>
  );
}
