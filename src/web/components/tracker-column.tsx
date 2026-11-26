import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import type { TrackerLaneKey } from "../lib/tracker-lanes.ts";
import { TrackerCard } from "./tracker-card.tsx";
import { Button } from "./ui/button.tsx";
import { dsEyebrow, dsMono } from "./ui/ds.ts";

const INITIAL_VISIBLE = 12;
const PAGE_STEP = 12;

function laneSurfaceClass(isOver: boolean, isValidDropTarget: boolean) {
  if (isOver && isValidDropTarget) {
    return "border-signal bg-signal-soft/45 ring-1 ring-signal/35";
  }

  if (isValidDropTarget) {
    return "border-dashed border-signal/50 bg-sidebar/80";
  }

  return "border-border bg-sidebar/40";
}

/**
 * Single stage column in the Application Tracker Kanban board with flat hairline chrome,
 * semantic stage indicator dot, and bounded internal scrolling on desktop.
 * @param props Column state, cards list, drop state, and handlers.
 * @returns Stage lane column element.
 */
export function TrackerColumn(props: {
  activeDragLane: TrackerLaneKey | null;
  cards: readonly BoardCard[];
  dotClass: string;
  droppable: boolean;
  keyboardDragCardId?: string | null | undefined;
  keyboardDragTargetLane?: TrackerLaneKey | null | undefined;
  label: string;
  lane: TrackerLaneKey;
  onCardKeyDown?:
    | ((card: BoardCard, lane: TrackerLaneKey, event: KeyboardEvent<HTMLButtonElement>) => void)
    | undefined;
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  const {
    activeDragLane,
    cards,
    dotClass,
    droppable,
    keyboardDragCardId = null,
    keyboardDragTargetLane = null,
    label,
    lane,
    onCardKeyDown,
    onOpen,
    selectedId,
  } = props;

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
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border transition ${laneSurfaceClass(isOver || isKeyboardDropTarget, isValidDropTarget || isKeyboardDropTarget)}`}
      data-stage={lane}
      ref={setNodeRef}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
          <h2 className={`${dsEyebrow} truncate text-foreground`}>{label}</h2>
          <span className={dsMono}>{cards.length}</span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="flex flex-col gap-2 p-2 lg:absolute lg:inset-0 lg:overflow-y-auto"
          data-scroll-region
        >
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
            <div className="flex min-h-28 flex-1 items-center justify-center rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              {isValidDropTarget ? copy.board.dropHere : copy.board.emptyLane}
            </div>
          ) : null}

          {isValidDropTarget && cards.length > 0 ? (
            <div className="rounded-md border border-dashed border-signal bg-card/80 px-3 py-2 text-center text-xs font-semibold text-signal-text">
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
      </div>
    </section>
  );
}
