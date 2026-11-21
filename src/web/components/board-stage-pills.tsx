import { copy } from "../../shared/copy.ts";
import { STAGE_KEYS } from "../lib/board-api.ts";
import type { StageKey } from "../lib/board-api.ts";

export function BoardStagePills(props: {
  counts: Record<StageKey, number>;
  hoverStage: StageKey | null;
  onSelect: (stage: StageKey) => void;
  selected: StageKey;
}) {
  return (
    <div
      aria-label={copy.board.stagesLabel}
      className="hs mt-[21px] flex gap-2 overflow-x-auto px-5 py-1"
      data-scroll-region
      role="tablist"
    >
      {STAGE_KEYS.map((stage) => (
        <button
          aria-selected={props.selected === stage}
          className={`stg ${props.selected === stage ? "on" : ""} ${
            props.hoverStage === stage
              ? "outline outline-2 outline-offset-2 outline-foreground"
              : ""
          }`}
          data-stage={stage}
          key={stage}
          onClick={() => {
            props.onSelect(stage);
          }}
          role="tab"
          type="button"
        >
          {copy.board.columns[stage]} <b className="num">{String(props.counts[stage])}</b>
        </button>
      ))}
    </div>
  );
}
