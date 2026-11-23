import { useDraggable } from "@dnd-kit/core";
import { ArrowRight, GripVertical, MapPin, Send } from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import type { TrackerLaneKey } from "../lib/tracker-lanes.ts";
import { cardBadgeFor, formatCardSalary } from "../lib/tracker-lanes.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsMono } from "./ui/ds.ts";

export function TrackerCard({
  card,
  draggable,
  lane,
  onOpen,
  selected,
}: {
  card: BoardCard;
  draggable: boolean;
  lane: TrackerLaneKey;
  onOpen: (id: string) => void;
  selected: boolean;
}) {
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
      listeners?.onKeyDown?.(event);
    }
  };

  return (
    <article
      className={`group rounded-xl border bg-card text-left transition ${
        selected
          ? "border-signal shadow-lift ring-1 ring-signal/30"
          : "border-border shadow-sh hover:border-signal/45 hover:shadow-lift"
      } ${isDragging ? "opacity-35" : ""}`}
      ref={setNodeRef}
    >
      <button
        aria-describedby={draggable ? attributes["aria-describedby"] : undefined}
        aria-disabled={draggable ? attributes["aria-disabled"] : undefined}
        aria-label={copy.board.openCard(card.title, card.company)}
        aria-pressed={draggable ? attributes["aria-pressed"] : undefined}
        aria-roledescription={draggable ? attributes["aria-roledescription"] : undefined}
        className={`block w-full p-4 text-left focus-visible:outline-none ${
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
        <div className="flex items-center gap-2.5">
          <CompanyAvatar company={card.company} logoUrl={card.logoUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{card.company}</p>
            <p className={`${dsMono} mt-0.5`}>{`${String(card.ageDays)}d`}</p>
          </div>
          {draggable ? (
            <GripVertical
              aria-hidden="true"
              className="shrink-0 text-muted-foreground/60 transition group-hover:text-signal-text"
              size={16}
            />
          ) : null}
        </div>

        <h3 className="mt-3 line-clamp-2 min-h-[2.75rem] font-serif text-card-title leading-snug text-foreground transition group-hover:text-signal-text">
          {card.title}
        </h3>

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
      </button>

      {lane === "ready" ? (
        <div className="border-t border-border px-4 pb-3.5 pt-2.5">
          <Button asChild className="w-full" size="sm" variant="primary">
            <Link to="/ready">
              <Send aria-hidden="true" size={14} />
              <span>{copy.board.reviewAndSend}</span>
            </Link>
          </Button>
        </div>
      ) : null}

      {lane === "review" && card.needsYou ? (
        <div className="border-t border-border px-4 pb-3.5 pt-2.5">
          <Button asChild className="w-full" size="sm" variant="secondary">
            <Link to="/review">
              <span>{copy.board.answerNow}</span>
              <ArrowRight aria-hidden="true" size={14} />
            </Link>
          </Button>
        </div>
      ) : null}
    </article>
  );
}
