import { GripVertical } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import type { TrackerLaneKey } from "../lib/tracker-lanes.ts";
import { cardBadgeFor, formatCardSalary } from "../lib/tracker-lanes.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsMono } from "./ui/ds.ts";

const EMPTY_SCORE = "—";

/**
 * Floating drag overlay card matching the sleek Tracker Board card token geometry.
 * @param props Dragged card payload and layout mode.
 * @returns Drag overlay element.
 */
export function TrackerOverlayCard(props: {
  card: BoardCard;
  compact?: boolean;
  lane: TrackerLaneKey;
}) {
  const { card, compact = false, lane } = props;

  if (compact) {
    return (
      <div className="inline-flex max-w-60 cursor-grabbing items-center gap-2 rounded-full border border-signal bg-card px-3 py-1.5 shadow-lift">
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
    <div className="w-56 cursor-grabbing rounded-md border border-signal bg-card p-3 shadow-lift">
      <div className="flex items-center gap-2">
        <CompanyAvatar
          className="h-6 w-6 rounded text-xs"
          company={card.company}
          logoUrl={card.logoUrl}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {card.company}
        </span>
        <span className={`${dsMono} shrink-0`}>{`${String(card.ageDays)}d`}</span>
        <GripVertical aria-hidden="true" className="shrink-0 text-signal-text" size={13} />
      </div>

      <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
        {card.title}
      </p>

      <p className="mt-1 truncate text-xs text-muted-foreground">
        {card.location ?? copy.board.locationFallback}
      </p>

      {salary === null ? null : (
        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground tabular-nums">
          {salary}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-1.5 border-t border-border/60 pt-2">
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${strongMatch ? "bg-signal" : "bg-muted-foreground/45"}`}
          />
          <span className={strongMatch ? "text-signal-text" : "text-muted-foreground"}>
            {card.score === null ? EMPTY_SCORE : copy.board.matchShort(card.score)}
          </span>
        </span>
        <Badge className="max-w-full shrink truncate" variant={badge.variant}>
          {badge.label}
        </Badge>
      </div>
    </div>
  );
}
