import { copy } from "../../shared/copy.ts";
import type { BoardCard as BoardCardData } from "../lib/board-api.ts";

export function BoardReadyCard(props: {
  card: BoardCardData;
  onSend: (card: BoardCardData) => void;
}) {
  const { card } = props;
  const ready = card.status === "ready";
  let noteNode = null;

  if (card.note !== null) {
    noteNode = ready ? (
      <span className="inline-flex items-center rounded-full bg-ok-soft px-[11px] py-[3px] text-[12px] font-semibold leading-normal text-ok">
        {card.note.label}
      </span>
    ) : (
      <span className="text-right text-[11.5px] font-semibold leading-[normal] text-ok">
        {card.note.label}
      </span>
    );
  }

  return (
    <div className="kc" data-card={card.id} style={{ display: "block" }}>
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
        {noteNode}
      </div>
      {ready ? (
        <button
          className="btn mt-2.5 w-full justify-center"
          onClick={() => {
            props.onSend(card);
          }}
          style={{ minHeight: 36 }}
          type="button"
        >
          {copy.board.send}
        </button>
      ) : null}
    </div>
  );
}
