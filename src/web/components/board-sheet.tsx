import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail, StageKey } from "../lib/board-api.ts";
import { BoardSheetActions } from "./board-sheet-actions.tsx";
import { BoardSheetHeader } from "./board-sheet-header.tsx";
import { BoardSheetNavigation } from "./board-sheet-navigation.tsx";
import { BoardSheetPanel } from "./board-sheet-panel.tsx";
import type { BoardTab } from "./board-sheet-panel.tsx";
import { BoardSentBanner } from "./board-sent-banner.tsx";
import { BoardSheetPills } from "./board-sheet-pills.tsx";

export function BoardSheet(props: {
  detail: ApplicationDetail | null;
  nextDisabled: boolean;
  onArchive: () => void;
  onClose: () => void;
  onMove: (stage: StageKey) => void;
  onNext: () => void;
  onPrevious: () => void;
  previousDisabled: boolean;
}) {
  const { detail } = props;
  const [tab, setTab] = useState<BoardTab>("timeline");

  const tabButton = (key: BoardTab, label: string) => (
    <button
      aria-selected={tab === key}
      className={`tab ${tab === key ? "on" : ""}`}
      onClick={() => {
        setTab(key);
      }}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-20 bg-[var(--color-scrim)]" />
      <aside
        aria-label={copy.board.sheetLabel}
        className="board fixed inset-x-0 bottom-0 z-30 flex h-[566px] flex-col overflow-hidden rounded-t-[18px] border-t border-input bg-card max-md:shadow-[0_-24px_50px_-28px_rgba(21,19,17,0.5)] md:inset-y-0 md:left-auto md:right-0 md:h-auto md:w-[468px] md:rounded-none md:border-t-0 md:border-l md:shadow-[-30px_0_60px_-34px_var(--color-scrim)] min-[1700px]:w-[520px]"
      >
        <button
          aria-label={copy.board.grabHandle}
          className="flex h-11 w-full flex-none items-center justify-center border-0 bg-transparent md:hidden"
          onClick={props.onClose}
          type="button"
        >
          <span className="h-[5px] w-11 rounded-[3px] bg-input" />
        </button>

        <BoardSheetNavigation
          detail={detail}
          nextDisabled={props.nextDisabled}
          onClose={props.onClose}
          onNext={props.onNext}
          onPrevious={props.onPrevious}
          previousDisabled={props.previousDisabled}
        />

        {detail === null ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <p className="text-[13px] text-muted-foreground">{copy.board.loadingDetail}</p>
          </div>
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 [&>*]:flex-none md:px-[26px] md:pt-[22px] md:pb-0"
            data-scroll-region
          >
            <BoardSheetHeader detail={detail} />
            <BoardSheetPills detail={detail} />
            <BoardSentBanner detail={detail} />
            <BoardSheetActions detail={detail} onArchive={props.onArchive} onMove={props.onMove} />
            <div
              aria-label={copy.board.sectionsLabel}
              className="hs mt-3.5 -mx-5 flex overflow-x-auto border-b border-border px-5 md:mx-0 md:mt-[22px] md:px-0"
              data-scroll-region
              role="tablist"
            >
              {tabButton("timeline", copy.board.tabs.timeline)}
              {tabButton("answers", copy.board.tabs.answers)}
              {tabButton("cover", copy.board.tabs.cover)}
              {tabButton("emails", copy.board.tabs.emails)}
            </div>
            <BoardSheetPanel detail={detail} tab={tab} />
            <p className="serif mt-auto pt-2.5 pb-[18px] text-center text-[14px] text-muted-foreground italic">
              {`— ${detail.application.id.slice(-4)} —`}
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
