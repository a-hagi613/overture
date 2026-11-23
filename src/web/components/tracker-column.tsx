import { useDroppable } from "@dnd-kit/core";
import { ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import type { TrackerLaneKey } from "../lib/tracker-lanes.ts";
import { TrackerCard } from "./tracker-card.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsCardTitle } from "./ui/ds.ts";

const INITIAL_VISIBLE = 4;
const PAGE_STEP = 6;

function laneSurfaceClass(isOver: boolean, isValidDropTarget: boolean) {
  if (isOver && isValidDropTarget) {
    return "border-signal bg-signal-soft/60 ring-2 ring-signal/35";
  }

  if (isValidDropTarget) {
    return "border-dashed border-signal/50 bg-sidebar/90";
  }

  return "border-border bg-sidebar";
}

export function TrackerColumn({
  accentClass,
  activeDragLane,
  cards,
  droppable,
  keyboardDragCardId = null,
  keyboardDragTargetLane = null,
  label,
  lane,
  linkTo,
  onCardKeyDown,
  onOpen,
  selectedId,
}: {
  accentClass: string;
  activeDragLane: TrackerLaneKey | null;
  cards: readonly BoardCard[];
  droppable: boolean;
  keyboardDragCardId?: string | null | undefined;
  keyboardDragTargetLane?: TrackerLaneKey | null | undefined;
  label: string;
  lane: TrackerLaneKey;
  linkTo: string | null;
  onCardKeyDown?:
    | ((card: BoardCard, lane: TrackerLaneKey, event: KeyboardEvent<HTMLButtonElement>) => void)
    | undefined;
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const { isOver, setNodeRef } = useDroppable({
    disabled: !droppable,
    id: lane,
  });

  const isValidDropTarget = droppable && activeDragLane !== null && activeDragLane !== lane;
  const isKeyboardDropTarget = droppable && keyboardDragTargetLane === lane;
  const visibleCards = cards.slice(0, visibleCount);
  const remaining = Math.max(0, cards.length - visibleCards.length);
  const expanded = visibleCount > INITIAL_VISIBLE && cards.length > INITIAL_VISIBLE;

  return (
    <section
      aria-label={label}
      className={`flex min-w-0 flex-col rounded-xl border border-t-2 p-3.5 transition ${accentClass} ${laneSurfaceClass(isOver || isKeyboardDropTarget, isValidDropTarget || isKeyboardDropTarget)}`}
      data-stage={lane}
      ref={setNodeRef}
    >
      <div className="mb-3.5 flex items-center justify-between gap-2 px-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className={`${dsCardTitle} truncate`}>{label}</h2>
          <Badge className="tabular-nums" variant="outline">
            {cards.length}
          </Badge>
        </div>
        {linkTo === null ? null : (
          <Link
            className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-muted-foreground transition hover:text-signal-text"
            to={linkTo}
          >
            <span>{lane === "ready" ? copy.board.openReady : copy.board.openReview}</span>
            <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {visibleCards.map((card) => (
          <TrackerCard
            card={card}
            draggable={droppable}
            isKeyboardDragging={keyboardDragCardId === card.id}
            key={card.id}
            lane={lane}
            onCardKeyDown={onCardKeyDown}
            onOpen={onOpen}
            selected={selectedId === card.id}
          />
        ))}

        {cards.length === 0 ? (
          <div className="flex min-h-28 flex-1 items-center justify-center rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {isValidDropTarget ? copy.board.dropHere : copy.board.emptyLane}
          </div>
        ) : null}

        {isValidDropTarget && cards.length > 0 ? (
          <div className="rounded-lg border border-dashed border-signal bg-card/80 px-3 py-2.5 text-center text-xs font-semibold text-signal-text">
            {copy.board.dropHere}
          </div>
        ) : null}

        {remaining > 0 ? (
          <Button
            className="w-full justify-center gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setVisibleCount((current) => current + PAGE_STEP);
            }}
            size="sm"
            variant="ghost"
          >
            <span>{copy.board.showMore(remaining)}</span>
            <ChevronDown aria-hidden="true" size={15} />
          </Button>
        ) : null}

        {remaining === 0 && expanded ? (
          <Button
            className="w-full justify-center gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setVisibleCount(INITIAL_VISIBLE);
            }}
            size="sm"
            variant="ghost"
          >
            <span>{copy.board.showLess}</span>
            <ChevronUp aria-hidden="true" size={15} />
          </Button>
        ) : null}
      </div>
    </section>
  );
}
