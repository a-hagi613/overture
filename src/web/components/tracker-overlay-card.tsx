import { GripVertical, MapPin } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import type { TrackerLaneKey } from "../lib/tracker-lanes.ts";
import { cardBadgeFor, formatCardSalary } from "../lib/tracker-lanes.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsMono } from "./ui/ds.ts";

export function TrackerOverlayCard({
  card,
  compact = false,
  lane,
}: {
  card: BoardCard;
  compact?: boolean;
  lane: TrackerLaneKey;
}) {
  if (compact) {
    return (
      <div className="inline-flex max-w-[230px] cursor-grabbing items-center gap-2 rounded-full border border-signal bg-card px-3 py-1.5 shadow-lift">
        <GripVertical aria-hidden="true" className="shrink-0 text-signal-text" size={14} />
        <span className="truncate text-xs font-semibold text-foreground">{card.company}</span>
        <span className="truncate text-xs text-muted-foreground">{card.title}</span>
      </div>
    );
  }

  const badge = cardBadgeFor(card, lane);
  const salary = formatCardSalary(card);
  const strongMatch = card.score !== null && card.score >= 80;

  return (
    <div className="w-[272px] rotate-1 cursor-grabbing rounded-xl border border-signal bg-card p-4 shadow-lift">
      <div className="flex items-center gap-2.5">
        <CompanyAvatar company={card.company} logoUrl={card.logoUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{card.company}</p>
          <p className={`${dsMono} mt-0.5`}>{`${String(card.ageDays)}d`}</p>
        </div>
        <GripVertical aria-hidden="true" className="shrink-0 text-signal-text" size={16} />
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.75rem] font-serif text-card-title leading-snug text-foreground">
        {card.title}
      </p>

      <div className="mt-2.5 space-y-1 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <MapPin aria-hidden="true" className="shrink-0" size={13} />
          <span className="truncate">{card.location ?? copy.board.locationFallback}</span>
        </div>
        {salary === null ? null : (
          <p className="font-mono text-xs text-muted-foreground tabular-nums">{salary}</p>
        )}
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${strongMatch ? "bg-signal" : "bg-muted-foreground/50"}`}
          />
          <span className={strongMatch ? "text-signal-text" : "text-muted-foreground"}>
            {card.score === null ? "—" : copy.board.matchPercent(card.score)}
          </span>
        </span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
    </div>
  );
}
