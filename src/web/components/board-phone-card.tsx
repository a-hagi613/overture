import type { PointerEvent } from "react";

import type { BoardCard } from "../lib/board-api.ts";

export function BoardPhoneCard(props: {
  card: BoardCard;
  holding: boolean;
  onOpen: () => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  selected: boolean;
}) {
  const { card } = props;

  return (
    <button
      className={`kc ${props.selected ? "sel" : ""} ${props.holding ? "hold" : ""}`}
      data-card={card.id}
      onClick={props.onOpen}
      onPointerCancel={props.onPointerCancel}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-[9px]">
          <span
            aria-hidden="true"
            className="serif flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[6px] bg-foreground text-[16px] italic text-background"
          >
            {card.company.slice(0, 1)}
          </span>
          <span className="relative -top-px truncate text-[13px] font-semibold">
            {card.company}
          </span>
        </span>
        <span className="num flex-none text-xs text-muted-foreground">
          {`${String(card.ageDays)}d`}
        </span>
      </div>
      <p className="serif mt-[9.5px] text-[24px] leading-[1.12]">{card.title}</p>
      <p className="mt-[3px] text-[13px] text-muted-foreground">{card.location}</p>
    </button>
  );
}
