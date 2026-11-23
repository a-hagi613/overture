import { useEffect, useRef, useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail, StageKey } from "../lib/board-api.ts";
import { BoardSentBanner } from "./board-sent-banner.tsx";
import { BoardSheetActions } from "./board-sheet-actions.tsx";
import { BoardSheetHeader } from "./board-sheet-header.tsx";
import { BoardSheetNavigation } from "./board-sheet-navigation.tsx";
import { BoardSheetPanel } from "./board-sheet-panel.tsx";
import type { BoardTab } from "./board-sheet-panel.tsx";
import { BoardSheetPills } from "./board-sheet-pills.tsx";
import { Button } from "./ui/button.tsx";
import { Separator } from "./ui/separator.tsx";
import { Tabs } from "./ui/tabs.tsx";
import { TabsList } from "./ui/tabs-list.tsx";
import { TabsTrigger } from "./ui/tabs-trigger.tsx";

function isBoardTab(value: string): value is BoardTab {
  return value === "timeline" || value === "answers" || value === "cover";
}

export function BoardSheet(props: {
  detail: ApplicationDetail | null;
  error?: boolean;
  nextDisabled: boolean;
  onArchive: () => void;
  onClose: () => void;
  onMove: (stage: StageKey) => void;
  onNext: () => void;
  onPrevious: () => void;
  onRetry?: () => void;
  positionLabel: string | null;
  previousDisabled: boolean;
}) {
  const { detail, error = false, onClose, onRetry } = props;
  const [tab, setTab] = useState<BoardTab>("timeline");
  const sheetRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = sheetRef.current;

    const focusable = () =>
      [
        ...(node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((item) => item.offsetParent !== null);

    (focusable().at(0) ?? node)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();

        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const items = focusable();
      const first = items.at(0);
      const last = items.at(-1);

      if (items.length === 0 || first === undefined || last === undefined) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node?.addEventListener("keydown", onKeyDown);

    return () => {
      node?.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      <button
        aria-label={copy.board.closeDetail}
        className="fixed inset-0 z-[55] bg-foreground/25 backdrop-blur-[1px]"
        onClick={onClose}
        type="button"
      />
      <dialog
        aria-label={copy.board.sheetLabel}
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 top-auto z-[60] m-0 flex h-[82dvh] max-h-none w-full max-w-none flex-col overflow-hidden rounded-t-2xl border-0 border-t border-border bg-card p-0 text-foreground shadow-lift outline-none md:inset-y-0 md:left-auto md:right-0 md:h-auto md:w-[500px] md:rounded-none md:border-l md:border-t-0 min-[1700px]:w-[540px]"
        open
        ref={sheetRef}
        tabIndex={-1}
      >
        <button
          aria-label={copy.board.grabHandle}
          className="flex h-10 w-full flex-none items-center justify-center md:hidden"
          onClick={onClose}
          type="button"
        >
          <span className="h-1.5 w-11 rounded-full bg-input" />
        </button>

        <BoardSheetNavigation
          nextDisabled={props.nextDisabled}
          onClose={onClose}
          onNext={props.onNext}
          onPrevious={props.onPrevious}
          positionLabel={props.positionLabel}
          previousDisabled={props.previousDisabled}
        />

        {detail === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            {error ? (
              <>
                <p className="text-sm font-semibold text-foreground" role="alert">
                  {copy.board.detailLoadFailed}
                </p>
                {onRetry === undefined ? null : (
                  <Button onClick={onRetry} size="sm" variant="outline">
                    {copy.inbox.retry}
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{copy.board.loadingDetail}</p>
            )}
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
      </dialog>
    </>
  );
}
