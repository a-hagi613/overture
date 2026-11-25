import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import type { TrackerLaneKey } from "../lib/tracker-lanes.ts";
import { cardBadgeFor, formatCardSalary } from "../lib/tracker-lanes.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsMono } from "./ui/ds.ts";

const EMPTY_SCORE = "—";

/**
 * Compact Linear/Attio-style application card rendered inside Tracker Board lanes.
 * @param props Card payload, drag/selection state, and keyboard/click callbacks.
 * @returns Draggable application card element.
 */
export function TrackerCard(props: {
  card: BoardCard;
  draggable: boolean;
  isKeyboardDragging?: boolean | undefined;
  lane: TrackerLaneKey;
  onCardKeyDown?:
    | ((card: BoardCard, lane: TrackerLaneKey, event: KeyboardEvent<HTMLButtonElement>) => void)
    | undefined;
  onOpen: (id: string) => void;
  selected: boolean;
}) {
  const {
    card,
    draggable,
    isKeyboardDragging = false,
    lane,
    onCardKeyDown,
    onOpen,
    selected,
  } = props;

  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    data: { card, lane },
    disabled: !draggable,
    id: card.id,
  });

  const badge = cardBadgeFor(card, lane);
  const salary = formatCardSalary(card);
  const strongMatch = card.score !== null && card.score >= 80;

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggable) {
      listeners?.onPointerDown?.(event);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (draggable) {
      onCardKeyDown?.(card, lane, event);
    }
  };

  return (
    <article
      className={`group rounded-md border bg-card text-left transition ${
        selected
          ? "border-signal ring-1 ring-signal/30"
          : "border-border hover:border-foreground/25"
      } ${isDragging ? "opacity-35" : ""} ${isKeyboardDragging ? "border-signal ring-2 ring-signal/45" : ""}`}
      ref={setNodeRef}
    >
      <button
        aria-describedby={draggable ? attributes["aria-describedby"] : undefined}
        aria-disabled={draggable ? attributes["aria-disabled"] : undefined}
        aria-pressed={isKeyboardDragging ? true : undefined}
        aria-roledescription={draggable ? attributes["aria-roledescription"] : undefined}
        className={`block w-full rounded-md p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
          draggable ? "touch-none cursor-grab active:cursor-grabbing" : "cursor-pointer"
        }`}
        data-card={card.id}
        onClick={() => {
          onOpen(card.id);
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        type="button"
      >
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
          {draggable ? (
            <GripVertical
              aria-hidden="true"
              className="shrink-0 text-muted-foreground/50 opacity-0 transition group-hover:opacity-100"
              size={13}
            />
          ) : null}
        </div>

        <h3 className="mt-1.5 line-clamp-2 break-words text-sm font-semibold leading-snug text-foreground">
          {card.title}
        </h3>

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
      </button>
    </article>
  );
}
