import type { KeyboardEvent, PointerEvent } from "react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard as BoardCardData, StageKey } from "../lib/board-api.ts";
import { BoardCard } from "./board-card.tsx";

const RULE_COLOURS = {
  applied: "var(--acc)",
  closed: "var(--mut)",
  interviewing: "var(--ok)",
  offer: "var(--ok)",
  queued: "var(--ink)",
  screening: "var(--ok)",
} satisfies Record<StageKey, string>;

const PREVIEW_LIMIT = {
  applied: 4,
  closed: 5,
  interviewing: 5,
  offer: 5,
  queued: 5,
  screening: 5,
} satisfies Record<StageKey, number>;

export function BoardColumn(props: {
  cards: BoardCardData[];
  draggingId: string | null;
  onOpen: (id: string) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (card: BoardCardData, event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onStageKey: (card: BoardCardData, direction: -1 | 1) => void;
  selectedId: string | null;
  stage: StageKey;
}) {
  const label = copy.board.columns[props.stage];
  const visible = props.cards.slice(0, PREVIEW_LIMIT[props.stage]);
  const hidden = props.cards.length - visible.length;

  const keyFor = (card: BoardCardData) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    props.onStageKey(card, event.key === "ArrowLeft" ? -1 : 1);
  };

  return (
    <section aria-label={label} className="w-[252px] flex-none" data-stage={props.stage}>
      <div
        className="mb-[14px] flex items-baseline justify-between border-t-[3px] pt-[11px]"
        style={{ borderTopColor: RULE_COLOURS[props.stage] }}
      >
        <h2 className="serif text-[25px] leading-none">{label}</h2>
        <span className="num rounded-full border border-border bg-muted px-[9px] py-px text-[12.5px] font-bold">
          {String(props.cards.length)}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {visible.map((card) => (
          <BoardCard
            card={card}
            dimmed={props.draggingId === card.id}
            key={card.id}
            onKeyDown={keyFor(card)}
            onOpen={() => {
              props.onOpen(card.id);
            }}
            onPointerCancel={props.onPointerCancel}
            onPointerDown={(event) => {
              props.onPointerDown(card, event);
            }}
            onPointerMove={props.onPointerMove}
            onPointerUp={props.onPointerUp}
            selected={props.selectedId === card.id}
          />
        ))}
        {hidden <= 0 ? null : (
          <p className="serif px-1 pt-0.5 text-[12.5px] text-muted-foreground italic">
            {copy.board.more(hidden, label)}
          </p>
        )}
      </div>
    </section>
  );
}
