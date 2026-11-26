import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  canMoveApplicationToStage,
  canWithdrawApplication,
  isBoardStage,
} from "../../shared/board.ts";
import { copy } from "../../shared/copy.ts";
import { BoardSheet } from "../components/board-sheet.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { TrackerColumn } from "../components/tracker-column.tsx";
import { TrackerList } from "../components/tracker-list.tsx";
import { TrackerMobileTab } from "../components/tracker-mobile-tab.tsx";
import { TrackerOverlayCard } from "../components/tracker-overlay-card.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { SegmentedControl } from "../components/ui/segmented-control.tsx";
import { SegmentedControlItem } from "../components/ui/segmented-control-item.tsx";
import {
  useApplication,
  useBoard,
  useMoveStage,
  useUndoStage,
  useWithdraw,
} from "../lib/board-api.ts";
import type { BoardCard, StageKey } from "../lib/board-api.ts";
import { onBoardMoved } from "../lib/live-events.ts";
import { useMediaQuery } from "../lib/media-query.ts";
import {
  MOBILE_TAB_PREFIX,
  TRACKER_LANES,
  groupCardsByLane,
  isTrackerLaneKey,
  laneForStage,
} from "../lib/tracker-lanes.ts";
import type { TrackerLaneKey } from "../lib/tracker-lanes.ts";

const detectLaneCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);

  return pointerHits.length > 0 ? pointerHits : closestCorners(args);
};

const DROPPABLE_LANES = TRACKER_LANES.filter((lane) => lane.droppable);

export function BoardPage({
  onChangeView,
  view,
}: {
  onChangeView: (next: string) => void;
  view: "board" | "list";
}) {
  const {
    data: board,
    isError: boardError,
    isPending: boardPending,
    refetch: refetchBoard,
  } = useBoard();

  const moveStage = useMoveStage();
  const undoStage = useUndoStage();
  const withdraw = useWithdraw();
  const isDesktopBoard = useMediaQuery("(min-width: 1024px)");
  const [searchParams, setSearchParams] = useSearchParams();
  const cardParam = searchParams.get("card") ?? searchParams.get("application");
  const selectedId = cardParam === "" ? null : cardParam;

  const laneParam = searchParams.get("filter");
  const requestedLane = laneParam !== null && isTrackerLaneKey(laneParam) ? laneParam : null;

  const [showClosed, setShowClosed] = useState(false);

  const mobileLane: TrackerLaneKey =
    requestedLane === "closed" && !showClosed ? "applied" : (requestedLane ?? "applied");

  const listFilter: TrackerLaneKey | "all" =
    requestedLane === null || (requestedLane === "closed" && !showClosed) ? "all" : requestedLane;

  const [laneOverrides, setLaneOverrides] = useState<Record<string, TrackerLaneKey>>({});

  const [activeDrag, setActiveDrag] = useState<{ card: BoardCard; lane: TrackerLaneKey } | null>(
    null,
  );

  const [keyboardDrag, setKeyboardDrag] = useState<{
    card: BoardCard;
    fromLane: TrackerLaneKey;
    targetLane: TrackerLaneKey;
  } | null>(null);

  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");

  const {
    data: detailData,
    isError: detailError,
    refetch: refetchDetail,
  } = useApplication(selectedId);

  const detail = detailData ?? null;

  const grouped = useMemo(() => groupCardsByLane(board, laneOverrides), [board, laneOverrides]);
  const allCards = useMemo(() => TRACKER_LANES.flatMap((lane) => grouped[lane.key]), [grouped]);

  const visibleLanes = useMemo(
    () => TRACKER_LANES.filter((lane) => lane.key !== "closed" || showClosed),
    [showClosed],
  );

  const closedCount = grouped.closed.length;

  const listCards = useMemo(
    () =>
      visibleLanes
        .filter((lane) => listFilter === "all" || lane.key === listFilter)
        .flatMap((lane) => grouped[lane.key])
        .toSorted((left, right) => right.updatedAt - left.updatedAt),
    [grouped, listFilter, visibleLanes],
  );

  const navigableCards = view === "list" ? listCards : allCards;
  const selectedIndex = navigableCards.findIndex((card) => card.id === selectedId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const { mutate: undoBoardStage } = undoStage;

  useEffect(
    () =>
      onBoardMoved((moved) => {
        if (moved.stage === null || !isBoardStage(moved.stage)) {
          return;
        }

        const label = copy.board.columns[moved.stage];

        if (moved.source === "email") {
          toast.success(copy.board.moved(label), {
            action: {
              label: copy.board.undo,
              onClick: () => {
                undoBoardStage(moved.applicationId);
              },
            },
          });
        } else if (moved.source === "system") {
          toast.success(copy.board.moved(label));
        }
      }),
    [undoBoardStage],
  );

  const writeParam = useCallback(
    (key: "application" | "filter", value: string | null, replace: boolean) => {
      const next = new URLSearchParams(searchParams);

      next.delete("application");
      next.delete("card");

      if (value === null || value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }

      setSearchParams(next, { replace });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    const legacy = searchParams.get("card");

    if (legacy === null || searchParams.has("application")) {
      return;
    }

    const next = new URLSearchParams(searchParams);

    next.delete("card");
    next.set("application", legacy);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const openCard = useCallback(
    (id: string) => {
      writeParam("application", id, false);
    },
    [writeParam],
  );

  const closeSheet = useCallback(() => {
    const closing = selectedId;

    writeParam("application", null, true);

    if (closing !== null) {
      globalThis.requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]") !== null) {
          return;
        }

        const candidates = [
          ...document.querySelectorAll<HTMLButtonElement>(`button[data-card="${closing}"]`),
        ];

        const visible =
          candidates.find((element) => element.offsetParent !== null) ?? candidates[0];

        visible?.focus();
      });
    }
  }, [selectedId, writeParam]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (keyboardDrag !== null) {
        setKeyboardAnnouncement(`Cancelled moving ${keyboardDrag.card.title}.`);
        setKeyboardDrag(null);

        return;
      }

      if (selectedId !== null) {
        closeSheet();
      }
    };

    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSheet, keyboardDrag, selectedId]);

  const clearLaneOverride = (id: string) => {
    setLaneOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
    );
  };

  const toggleClosed = () => {
    const next = !showClosed;

    if (!next && requestedLane === "closed") {
      writeParam("filter", null, true);
    }

    setShowClosed(next);
  };

  const moveCardToLane = (
    card: BoardCard,
    fromLane: TrackerLaneKey,
    targetLane: TrackerLaneKey,
    targetStage: StageKey,
    label: string,
  ) => {
    if (fromLane === targetLane && card.stage === targetStage) {
      return;
    }

    if (!canMoveApplicationToStage(card.status, targetStage)) {
      toast.error(copy.board.moveNotAllowed);

      return;
    }

    setLaneOverrides((current) => ({ ...current, [card.id]: targetLane }));

    moveStage.mutate(
      { id: card.id, stage: targetStage },
      {
        onError: () => {
          clearLaneOverride(card.id);
          toast.error(copy.board.moveFailed);
        },
        onSuccess: () => {
          clearLaneOverride(card.id);
          toast.success(copy.board.movedToLane(card.company, label), {
            action: {
              label: copy.board.undo,
              onClick: () => {
                setLaneOverrides((current) => ({ ...current, [card.id]: fromLane }));

                undoStage.mutate(card.id, {
                  onError: () => {
                    clearLaneOverride(card.id);
                    toast.error(copy.board.moveFailed);
                  },
                  onSuccess: () => {
                    clearLaneOverride(card.id);
                  },
                });
              },
            },
          });
        },
      },
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    setKeyboardDrag(null);

    const draggedId = String(event.active.id);
    const found = allCards.find((card) => card.id === draggedId);

    if (found === undefined) {
      return;
    }

    const lane = laneOverrides[found.id] ?? laneForStage(found.stage);

    if (lane !== null) {
      setActiveDrag({ card: found, lane });
    }
  };

  const handleCardKeyDown = (
    card: BoardCard,
    lane: TrackerLaneKey,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!DROPPABLE_LANES.some((entry) => entry.key === lane)) {
      return;
    }

    if (keyboardDrag === null) {
      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        setKeyboardDrag({ card, fromLane: lane, targetLane: lane });
        setKeyboardAnnouncement(
          `Picked up ${card.title}. Use Left and Right arrow keys to choose a stage, Space to drop, Escape to cancel.`,
        );
      }

      return;
    }

    if (keyboardDrag.card.id !== card.id) {
      return;
    }

    if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      event.preventDefault();

      const currentIndex = DROPPABLE_LANES.findIndex(
        (entry) => entry.key === keyboardDrag.targetLane,
      );

      const step = event.code === "ArrowRight" ? 1 : -1;
      const baseIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = Math.max(0, Math.min(DROPPABLE_LANES.length - 1, baseIndex + step));
      const nextLane = DROPPABLE_LANES[nextIndex];

      if (nextLane !== undefined) {
        setKeyboardDrag({ ...keyboardDrag, targetLane: nextLane.key });
        setKeyboardAnnouncement(`Over ${nextLane.label}.`);
        document
          .querySelector<HTMLElement>(`section[data-stage="${nextLane.key}"]`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }

      return;
    }

    if (event.code === "Space" || event.key === " " || event.code === "Enter") {
      event.preventDefault();

      const target = DROPPABLE_LANES.find((entry) => entry.key === keyboardDrag.targetLane);
      const { card: draggedCard, fromLane } = keyboardDrag;

      setKeyboardDrag(null);

      if (target !== undefined && target.droppable && target.key !== fromLane) {
        moveCardToLane(draggedCard, fromLane, target.key, target.targetStage, target.label);
        setKeyboardAnnouncement(`Moved ${draggedCard.title} to ${target.label}.`);
      } else {
        setKeyboardAnnouncement(`Dropped ${draggedCard.title} in ${target?.label ?? lane}.`);
      }

      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setKeyboardDrag(null);
      setKeyboardAnnouncement(`Cancelled moving ${card.title}.`);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragged = activeDrag;

    setActiveDrag(null);

    if (dragged === null || event.over === null) {
      return;
    }

    const rawOverId = String(event.over.id);

    const overId = rawOverId.startsWith(MOBILE_TAB_PREFIX)
      ? rawOverId.slice(MOBILE_TAB_PREFIX.length)
      : rawOverId;

    if (!isTrackerLaneKey(overId) || overId === dragged.lane) {
      return;
    }

    const targetLane = TRACKER_LANES.find((lane) => lane.key === overId);

    if (targetLane === undefined || !targetLane.droppable) {
      return;
    }

    moveCardToLane(
      dragged.card,
      dragged.lane,
      targetLane.key,
      targetLane.targetStage,
      targetLane.label,
    );
  };

  const handleArchive = () => {
    if (detail === null) {
      return;
    }

    const card = allCards.find((entry) => entry.id === detail.application.id);

    if (card === undefined) {
      return;
    }

    if (canWithdrawApplication(card.status)) {
      setLaneOverrides((current) => ({ ...current, [card.id]: "closed" }));
      writeParam("application", null, true);

      withdraw.mutate(card.id, {
        onError: () => {
          clearLaneOverride(card.id);
          toast.error(copy.board.moveFailed);
        },
        onSuccess: () => {
          clearLaneOverride(card.id);
          toast.success(copy.board.withdrawSuccess(card.company));
        },
      });

      return;
    }

    const fromLane = laneOverrides[card.id] ?? laneForStage(card.stage) ?? "applied";

    moveCardToLane(card, fromLane, "closed", "closed", copy.board.lanes.closed);
    writeParam("application", null, true);
  };

  const activeMobileLane =
    TRACKER_LANES.find((lane) => lane.key === mobileLane) ?? TRACKER_LANES[1];

  const selectedPosition =
    selectedIndex === -1
      ? null
      : copy.board.sheetPosition(selectedIndex + 1, navigableCards.length);

  const laneCounts = new Map<TrackerLaneKey, number>();
  let visibleCount = 0;

  for (const lane of visibleLanes) {
    const count = grouped[lane.key].length;

    laneCounts.set(lane.key, count);
    visibleCount += count;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2 max-md:w-full">
            {!boardPending && !boardError && closedCount > 0 ? (
              <Button
                ariaExpanded={showClosed}
                ariaPressed={showClosed}
                className="max-md:min-h-11"
                onClick={toggleClosed}
                size="sm"
                variant="outline"
              >
                {showClosed ? copy.board.closed.hide : copy.board.closed.show(closedCount)}
              </Button>
            ) : null}

            <SegmentedControl
              ariaLabel={copy.board.views.label}
              className="gap-1 max-md:flex-1"
              onValueChange={onChangeView}
              value={view}
            >
              <SegmentedControlItem className="flex-1 md:flex-none" value="board">
                {copy.board.views.board}
              </SegmentedControlItem>
              <SegmentedControlItem className="flex-1 md:flex-none" value="list">
                {copy.board.views.list}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
        }
        titleNode={`${copy.board.trackerTitlePlain} ${copy.board.trackerTitleItalic}`}
      />

      {boardPending ? (
        <Card ariaBusy className="mt-3 flex-1 p-5">
          <div className="animate-pulse space-y-3">
            <span className="sr-only">{copy.shell.loadingPage}</span>
            <div className="h-5 w-1/4 rounded bg-muted" />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="h-64 rounded bg-muted" />
              <div className="h-64 rounded bg-muted" />
              <div className="h-64 rounded bg-muted" />
            </div>
          </div>
        </Card>
      ) : null}

      {boardError ? (
        <Card className="mt-3 flex flex-wrap items-center justify-between gap-4 p-6">
          <p className="text-sm font-semibold text-foreground" role="alert">
            {copy.board.loadFailed}
          </p>
          <Button
            onClick={() => {
              void refetchBoard();
            }}
            size="sm"
            variant="outline"
          >
            {copy.inbox.retry}
          </Button>
        </Card>
      ) : null}

      {!boardPending && !boardError && view === "list" ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <fieldset
            aria-label={copy.board.stagesLabel}
            className="m-0 flex min-w-0 shrink-0 flex-wrap gap-2 border-0 p-0"
          >
            {(["all", ...visibleLanes.map((lane) => lane.key)] as const).map((key) => {
              const selected = listFilter === key;
              const count = key === "all" ? visibleCount : (laneCounts.get(key) ?? 0);

              const label =
                key === "all"
                  ? copy.board.list.all
                  : (TRACKER_LANES.find((lane) => lane.key === key)?.label ?? key);

              return (
                <Button
                  ariaPressed={selected}
                  className="flex-none"
                  key={key}
                  onClick={() => {
                    writeParam("filter", key === "all" ? null : key, true);
                  }}
                  size="sm"
                  variant={selected ? "primary" : "outline"}
                >
                  <span>{label}</span>
                  <span className="text-xs opacity-75 tabular-nums">{count}</span>
                </Button>
              );
            })}
          </fieldset>

          <TrackerList cards={listCards} onOpen={openCard} selectedId={selectedId} />
        </div>
      ) : null}

      {!boardPending && !boardError && view === "board" ? (
        <DndContext
          collisionDetection={detectLaneCollision}
          onDragCancel={() => {
            setActiveDrag(null);
          }}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          {isDesktopBoard ? (
            <div
              className={`mt-3 grid min-h-0 flex-1 gap-3 ${
                showClosed ? "grid-cols-4" : "grid-cols-3"
              }`}
            >
              {visibleLanes.map((lane) => (
                <TrackerColumn
                  activeDragLane={activeDrag?.lane ?? null}
                  cards={grouped[lane.key]}
                  dotClass={lane.dotClass}
                  droppable={lane.droppable}
                  keyboardDragCardId={keyboardDrag?.card.id ?? null}
                  keyboardDragTargetLane={keyboardDrag?.targetLane ?? null}
                  key={lane.key}
                  label={lane.label}
                  lane={lane.key}
                  onCardKeyDown={handleCardKeyDown}
                  onOpen={openCard}
                  selectedId={selectedId}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <div className="scrollbar-none -mx-4 overflow-x-auto px-4" data-scroll-region>
                <SegmentedControl
                  ariaLabel={copy.board.stagesLabel}
                  className="flex w-full gap-1"
                  onValueChange={(value) => {
                    if (isTrackerLaneKey(value)) {
                      writeParam("filter", value, true);
                    }
                  }}
                  value={mobileLane}
                >
                  {visibleLanes.map((lane) => (
                    <TrackerMobileTab
                      activeDragLane={activeDrag?.lane ?? null}
                      droppable={lane.droppable}
                      key={lane.key}
                      label={lane.label}
                      lane={lane.key}
                    />
                  ))}
                </SegmentedControl>
              </div>

              <p className="mt-2 text-center text-xs text-muted-foreground">
                {copy.board.mobileDropHint}
              </p>

              {activeMobileLane === undefined ? null : (
                <div className="mt-3">
                  <TrackerColumn
                    activeDragLane={activeDrag?.lane ?? null}
                    cards={grouped[activeMobileLane.key]}
                    dotClass={activeMobileLane.dotClass}
                    droppable={activeMobileLane.droppable}
                    keyboardDragCardId={keyboardDrag?.card.id ?? null}
                    keyboardDragTargetLane={keyboardDrag?.targetLane ?? null}
                    label={activeMobileLane.label}
                    lane={activeMobileLane.key}
                    onCardKeyDown={handleCardKeyDown}
                    onOpen={openCard}
                    selectedId={selectedId}
                  />
                </div>
              )}
            </div>
          )}

          <DragOverlay>
            {activeDrag === null ? null : (
              <TrackerOverlayCard
                card={activeDrag.card}
                compact={!isDesktopBoard}
                lane={activeDrag.lane}
              />
            )}
          </DragOverlay>
        </DndContext>
      ) : null}

      <output aria-live="polite" className="sr-only">
        {keyboardAnnouncement}
      </output>

      {selectedId === null ? null : (
        <BoardSheet
          detail={detail}
          error={detailError}
          nextDisabled={selectedIndex === -1 || selectedIndex >= navigableCards.length - 1}
          onArchive={handleArchive}
          onClose={closeSheet}
          onMove={(stage) => {
            const card = navigableCards.find((entry) => entry.id === selectedId);
            const targetLane = laneForStage(stage);

            if (card !== undefined && targetLane !== null && targetLane !== "queue") {
              const fromLane = laneOverrides[card.id] ?? laneForStage(card.stage) ?? "applied";

              moveCardToLane(card, fromLane, targetLane, stage, copy.board.columns[stage]);
            }
          }}
          onNext={() => {
            const nextCard = navigableCards[selectedIndex + 1];

            if (nextCard !== undefined) {
              writeParam("application", nextCard.id, true);
            }
          }}
          onPrevious={() => {
            const previousCard = navigableCards[selectedIndex - 1];

            if (previousCard !== undefined) {
              writeParam("application", previousCard.id, true);
            }
          }}
          onRetry={() => {
            void refetchDetail();
          }}
          positionLabel={selectedPosition}
          previousDisabled={selectedIndex <= 0}
        />
      )}
    </div>
  );
}
