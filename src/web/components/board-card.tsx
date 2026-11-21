import type { KeyboardEvent, PointerEvent } from "react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard as BoardCardData } from "../lib/board-api.ts";

function toneClass(tone: string) {
  switch (tone) {
    case "accent": {
      return "text-signal-text";
    }

    case "ink": {
      return "text-foreground";
    }

    case "muted": {
      return "text-muted-foreground";
    }

    case "ok": {
      return "text-ok";
    }

    default: {
      return "";
    }
  }
}

function pillClass(tone: string) {
  switch (tone) {
    case "declined": {
      return "oc-decl";
    }

    case "ghost": {
      return "oc-ghost";
    }

    case "need": {
      return "oc-rej";
    }

    case "rejected": {
      return "oc-rej";
    }

    case "withdrawn": {
      return "oc-with";
    }

    default: {
      return null;
    }
  }
}

function money(card: BoardCardData) {
  const { salary } = card;

  if (salary === null) {
    return null;
  }

  if (salary.currency === null) {
    return null;
  }

  const period = salary.period ?? "year";
  let divisor = 100;
  let suffix = "/hr";

  if (period === "year") {
    divisor = 100_000;
    suffix = "k";
  } else if (period === "month") {
    suffix = "/mo";
  }

  const minimum = String(Math.round(salary.minMinor / divisor));
  const maximum = salary.maxMinor === null ? null : String(Math.round(salary.maxMinor / divisor));

  return copy.board.salary(minimum, maximum, salary.currency, suffix);
}

function noteNode(note: BoardCardData["note"], pill: string | null, tone: string) {
  if (note === null) {
    return null;
  }

  if (pill !== null) {
    return <span className={`oc ${pill}`}>{note.label}</span>;
  }

  return (
    <span className={`text-right text-xs font-semibold md:text-[11.5px] ${tone}`}>
      {note.label}
    </span>
  );
}

export function BoardCard(props: {
  card: BoardCardData;
  dimmed: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  selected: boolean;
}) {
  const { card } = props;
  const { note } = card;
  const tone = note === null ? "" : toneClass(note.tone);
  const pill = note === null ? null : pillClass(note.tone);
  const salary = money(card);

  return (
    <button
      className={`kc ${props.selected ? "sel" : ""} ${props.dimmed ? "dragging" : ""}`}
      data-card={card.id}
      onClick={props.onOpen}
      onKeyDown={props.onKeyDown}
      onPointerCancel={props.onPointerCancel}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-[9px] md:gap-2">
          <span
            aria-hidden="true"
            className="serif flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[6px] bg-foreground text-[16px] italic text-background md:h-6 md:w-6 md:rounded-[5px] md:text-[15px]"
          >
            {card.company.slice(0, 1)}
          </span>
          <span className="truncate text-[13px] font-semibold md:text-[12.5px]">
            {card.company}
          </span>
        </span>
        <span className="num flex-none text-xs text-muted-foreground">
          {`${String(card.ageDays)}d`}
        </span>
      </div>
      <p className="serif mt-[9px] text-[24px] leading-[1.12] md:text-[21px]">{card.title}</p>
      <p className="mt-[3px] text-[13px] text-muted-foreground md:mt-[3px] md:text-[12.5px]">
        {card.location}
        {salary === null ? null : <span className="num md:hidden">{` · ${salary}`}</span>}
      </p>
      <div className="mt-[11px] flex items-center justify-between gap-2 border-t border-border pt-[10px]">
        <span className="flex items-baseline gap-1.5">
          <span
            className={`serif num text-[27px] leading-none italic md:text-[25px] ${
              card.strong ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {card.score === null ? "—" : String(card.score)}
          </span>
          <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
            {copy.board.matchLabel}
          </span>
        </span>
        {noteNode(note, pill, tone)}
      </div>
    </button>
  );
}
