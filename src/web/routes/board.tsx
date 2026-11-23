import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { canMoveApplicationToStage, canWithdrawApplication } from "../../shared/board.ts";
import { copy } from "../../shared/copy.ts";
import { BoardSheet } from "../components/board-sheet.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { TrackerColumn } from "../components/tracker-column.tsx";
import { TrackerMobileTab } from "../components/tracker-mobile-tab.tsx";
import { TrackerOverlayCard } from "../components/tracker-overlay-card.tsx";
import { Tabs } from "../components/ui/tabs.tsx";
import { TabsList } from "../components/ui/tabs-list.tsx";
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

export function BoardPage() {
  const { data: board } = useBoard();
  const moveStage = useMoveStage();
  const undoStage = useUndoStage();
  const withdraw = useWithdraw();
  const isDesktopBoard = useMediaQuery("(min-width: 1024px)");
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("application"));
  const [mobileLane, setMobileLane] = useState<TrackerLaneKey>("applied");
  const [laneOverrides, setLaneOverrides] = useState<Record<string, TrackerLaneKey>>({});

  const [activeDrag, setActiveDrag] = useState<{ card: BoardCard; lane: TrackerLaneKey } | null>(
    null,
  );

  const { data: detailData } = useApplication(selectedId);
  const detail = detailData ?? null;

  const grouped = groupCardsByLane(board, laneOverrides);
  const allCards = TRACKER_LANES.flatMap((lane) => grouped[lane.key]);
  const selectedIndex = allCards.findIndex((card) => card.id === selectedId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(
    () =>
      onBoardMoved((moved) => {
        if (moved.stage !== null && isTrackerLaneKey(moved.stage)) {
          toast.success(copy.board.moved(copy.board.lanes[moved.stage]));
        }
      }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (selectedId !== null && event.key === "Escape") {
        setSelectedId(null);
      }
    };

    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedId]);

  const clearLaneOverride = (id: string) => {
    setLaneOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
    );
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
      setSelectedId(null);

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
    setSelectedId(null);
  };

  const activeMobileLane =
    TRACKER_LANES.find((lane) => lane.key === mobileLane) ?? TRACKER_LANES[2];

  const selectedPosition =
    selectedIndex === -1 ? null : copy.board.sheetPosition(selectedIndex + 1, allCards.length);

  return (
    <div>
      <PageHeader
        lead={copy.board.trackerLead}
        titleNode={
          <>
            {copy.board.trackerTitlePlain}{" "}
            <em className="italic text-signal">{copy.board.trackerTitleItalic}</em>
          </>
        }
      />

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
          <div className="mt-6 overflow-x-auto pb-3" data-scroll-region>
            <div className="grid grid-cols-[repeat(5,minmax(264px,1fr))] items-start gap-4">
              {TRACKER_LANES.map((lane) => (
                <TrackerColumn
                  accentClass={lane.accentClass}
                  activeDragLane={activeDrag?.lane ?? null}
                  cards={grouped[lane.key]}
                  droppable={lane.droppable}
                  key={lane.key}
                  label={lane.label}
                  lane={lane.key}
                  linkTo={lane.linkTo}
                  onOpen={setSelectedId}
                  selectedId={selectedId}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-5">
            <Tabs
              onValueChange={(value) => {
                if (isTrackerLaneKey(value)) {
                  setMobileLane(value);
                }
              }}
              value={mobileLane}
            >
              <TabsList ariaLabel={copy.board.stagesLabel} className="flex w-full gap-1">
                {TRACKER_LANES.map((lane) => (
                  <TrackerMobileTab
                    activeDragLane={activeDrag?.lane ?? null}
                    droppable={lane.droppable}
                    key={lane.key}
                    label={lane.label}
                    lane={lane.key}
                  />
                ))}
              </TabsList>
            </Tabs>

            <p className="mt-2 text-center text-xs text-muted-foreground">
              {copy.board.mobileDropHint}
            </p>

            {activeMobileLane === undefined ? null : (
              <div className="mt-3">
                <TrackerColumn
                  accentClass={activeMobileLane.accentClass}
                  activeDragLane={activeDrag?.lane ?? null}
                  cards={grouped[activeMobileLane.key]}
                  droppable={activeMobileLane.droppable}
                  label={activeMobileLane.label}
                  lane={activeMobileLane.key}
                  linkTo={activeMobileLane.linkTo}
                  onOpen={setSelectedId}
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

      {selectedId === null ? null : (
        <BoardSheet
          detail={detail}
          nextDisabled={selectedIndex === -1 || selectedIndex >= allCards.length - 1}
          onArchive={handleArchive}
          onClose={() => {
            setSelectedId(null);
          }}
          onMove={(stage) => {
            const card = allCards.find((entry) => entry.id === selectedId);
            const targetLane = laneForStage(stage);

            if (
              card !== undefined &&
              targetLane !== null &&
              targetLane !== "review" &&
              targetLane !== "ready"
            ) {
              const fromLane = laneOverrides[card.id] ?? laneForStage(card.stage) ?? "applied";

              moveCardToLane(card, fromLane, targetLane, stage, copy.board.columns[stage]);
            }
          }}
          onNext={() => {
            const nextCard = allCards[selectedIndex + 1];

            if (nextCard !== undefined) {
              setSelectedId(nextCard.id);
            }
          }}
          onPrevious={() => {
            const previousCard = allCards[selectedIndex - 1];

            if (previousCard !== undefined) {
              setSelectedId(previousCard.id);
            }
          }}
          positionLabel={selectedPosition}
          previousDisabled={selectedIndex <= 0}
        />
      )}
    </div>
  );
}
