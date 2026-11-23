import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail, StageKey } from "../lib/board-api.ts";
import { BoardSentBanner } from "./board-sent-banner.tsx";
import { BoardSheetActions } from "./board-sheet-actions.tsx";
import { BoardSheetHeader } from "./board-sheet-header.tsx";
import { BoardSheetNavigation } from "./board-sheet-navigation.tsx";
import { BoardSheetPanel } from "./board-sheet-panel.tsx";
import type { BoardTab } from "./board-sheet-panel.tsx";
import { BoardSheetPills } from "./board-sheet-pills.tsx";
import { Separator } from "./ui/separator.tsx";
import { Tabs } from "./ui/tabs.tsx";
import { TabsList } from "./ui/tabs-list.tsx";
import { TabsTrigger } from "./ui/tabs-trigger.tsx";

function isBoardTab(value: string): value is BoardTab {
  return value === "timeline" || value === "answers" || value === "cover";
}

export function BoardSheet(props: {
  detail: ApplicationDetail | null;
  nextDisabled: boolean;
  onArchive: () => void;
  onClose: () => void;
  onMove: (stage: StageKey) => void;
  onNext: () => void;
  onPrevious: () => void;
  positionLabel: string | null;
  previousDisabled: boolean;
}) {
  const { detail } = props;
  const [tab, setTab] = useState<BoardTab>("timeline");

  return (
    <>
      <button
        aria-label={copy.board.closeDetail}
        className="fixed inset-0 z-20 bg-foreground/25 backdrop-blur-[1px]"
        onClick={props.onClose}
        type="button"
      />
      <aside
        aria-label={copy.board.sheetLabel}
        className="fixed inset-x-0 bottom-0 z-30 flex h-[82dvh] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-lift md:inset-y-0 md:left-auto md:right-0 md:h-auto md:w-[500px] md:rounded-none md:border-l md:border-t-0 min-[1700px]:w-[540px]"
      >
        <button
          aria-label={copy.board.grabHandle}
          className="flex h-10 w-full flex-none items-center justify-center md:hidden"
          onClick={props.onClose}
          type="button"
        >
          <span className="h-1.5 w-11 rounded-full bg-input" />
        </button>

        <BoardSheetNavigation
          nextDisabled={props.nextDisabled}
          onClose={props.onClose}
          onNext={props.onNext}
          onPrevious={props.onPrevious}
          positionLabel={props.positionLabel}
          previousDisabled={props.previousDisabled}
        />

        {detail === null ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <p className="text-sm text-muted-foreground">{copy.board.loadingDetail}</p>
          </div>
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-8 pt-2 md:px-7 md:pt-6"
            data-scroll-region
          >
            <BoardSheetHeader detail={detail} />
            <BoardSheetPills detail={detail} />
            <BoardSentBanner detail={detail} />
            <BoardSheetActions detail={detail} onArchive={props.onArchive} onMove={props.onMove} />

            <Separator className="mt-5" />

            <div className="mt-5">
              <Tabs
                onValueChange={(value) => {
                  if (isBoardTab(value)) {
                    setTab(value);
                  }
                }}
                value={tab}
              >
                <TabsList ariaLabel={copy.board.sectionsLabel} className="flex w-full">
                  <TabsTrigger className="flex-1 whitespace-nowrap px-2.5" value="timeline">
                    {copy.board.tabs.timeline}
                  </TabsTrigger>
                  <TabsTrigger className="flex-1 whitespace-nowrap px-2.5" value="answers">
                    {copy.board.tabs.answers}
                  </TabsTrigger>
                  <TabsTrigger className="flex-none whitespace-nowrap px-3" value="cover">
                    {copy.board.tabs.cover}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <BoardSheetPanel detail={detail} tab={tab} />
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
