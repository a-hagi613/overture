import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { PointerEvent } from "react";

import { copy } from "../../shared/copy.ts";
import {
  useBoard,
  useApplication,
  useMoveStage,
  useUndoStage,
  useWithdraw,
} from "../lib/board-api.ts";
import type { BoardCard, StageKey } from "../lib/board-api.ts";
import { stageOf } from "../lib/board-format.ts";
import { useHomeData, useRunning } from "../lib/home-api.ts";
import { onBoardMoved } from "../lib/live-events.ts";
import { BoardColumn } from "../components/board-column.tsx";
import { BoardMobileHeader } from "../components/board-mobile-header.tsx";
import { BoardPageHeader } from "../components/board-page-header.tsx";
import { BoardPhoneCard } from "../components/board-phone-card.tsx";
import { BoardSheet } from "../components/board-sheet.tsx";
import { BoardStagePills } from "../components/board-stage-pills.tsx";

const STAGE_ORDER = [
  "queued",
  "ready",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "closed",
] as const;

const NEXT_STAGE = {
  applied: "screening",
  closed: null,
  interviewing: "offer",
  offer: "closed",
  queued: "applied",
  ready: null,
  screening: "interviewing",
} satisfies Record<StageKey, StageKey | null>;

const PREVIOUS_STAGE = {
  applied: "queued",
  closed: "offer",
  interviewing: "screening",
  offer: "interviewing",
  queued: null,
  ready: null,
  screening: "applied",
} satisfies Record<StageKey, StageKey | null>;

const HOLD_MS = 250;

function nextStage(current: StageKey, direction: -1 | 1) {
  return direction === 1 ? (NEXT_STAGE[current] ?? null) : (PREVIOUS_STAGE[current] ?? null);
}

export function BoardPage() {
  const { data: board } = useBoard();
  const moveStage = useMoveStage();
  const undoStage = useUndoStage();
  const withdraw = useWithdraw();
  const { data: home } = useHomeData();
  const running = useRunning();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileStage, setMobileStage] = useState<StageKey>("queued");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [holdingId, setHoldingId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<StageKey | null>(null);
  const [toast, setToast] = useState<{ message: string; undoId: string | null } | null>(null);
  const holdTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  const dragCard = useRef<BoardCard | null>(null);
  const dragging = useRef(false);
  const held = useRef<string | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const { data: detailData } = useApplication(selectedId);
  const detail = detailData ?? null;

  const columns = board?.columns ?? [];
  const cards = columns.flatMap((column) => column.cards);
  const selectedIndex = cards.findIndex((card) => card.id === selectedId);

  useEffect(
    () => () => {
      if (holdTimer.current !== null) {
        globalThis.clearTimeout(holdTimer.current);
      }

      if (toastTimer.current !== null) {
        globalThis.clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedId(null);
      }
    };

    globalThis.addEventListener("keydown", onKey);

    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, []);

  const showToast = useCallback((message: string, undoId: string | null = null) => {
    setToast({ message, undoId });

    if (toastTimer.current !== null) {
      globalThis.clearTimeout(toastTimer.current);
    }

    toastTimer.current = globalThis.setTimeout(() => {
      setToast(null);
    }, 4000);
  }, []);

  useEffect(
    () =>
      onBoardMoved((event) => {
        if (event.source !== "email" && event.source !== "system") {
          return;
        }

        const stage = stageOf(event.stage ?? undefined);

        if (stage === null) {
          return;
        }

        showToast(copy.board.moved(copy.board.columns[stage]), event.applicationId);
      }),
    [showToast],
  );

  const undoMove = (id: string) => {
    undoStage.mutate(id, {
      onSuccess: () => {
        setToast(null);
      },
    });
  };

  const moveTo = (id: string, stage: StageKey) => {
    moveStage.mutate(
      { id, stage },
      {
        onSuccess: () => {
          showToast(copy.board.moved(copy.board.columns[stage]));
        },
      },
    );
  };

  const move = (card: BoardCard, stage: StageKey) => {
    if (card.stage !== stage) {
      moveTo(card.id, stage);
    }
  };

  const onKey = (card: BoardCard, direction: -1 | 1) => {
    if (card.stage === null) {
      return;
    }

    const target = nextStage(card.stage, direction);

    if (target !== null) {
      move(card, target);
    }
  };

  const open = (id: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;

      return;
    }

    const card = cards.find((candidate) => candidate.id === id);

    if (card?.stage !== null && card?.stage !== undefined) {
      setMobileStage(card.stage);
    }

    setSelectedId(id);
  };

  const startDrag = (card: BoardCard, event: PointerEvent<HTMLButtonElement>) => {
    holdStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.pointerType === "mouse" && globalThis.matchMedia("(min-width: 768px)").matches) {
      dragCard.current = card;

      return;
    }

    holdTimer.current = globalThis.setTimeout(() => {
      held.current = card.id;
      setHoldingId(card.id);
      setHoverStage(card.stage);
    }, HOLD_MS);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (holdStart.current === null) {
      return;
    }

    const dx = Math.abs(event.clientX - holdStart.current.x);
    const dy = Math.abs(event.clientY - holdStart.current.y);

    if (dragCard.current !== null) {
      if (!dragging.current && (dx > 6 || dy > 6)) {
        dragging.current = true;
        setDraggingId(dragCard.current.id);
      }

      return;
    }

    if (holdingId === null) {
      if ((dx > 10 || dy > 10) && holdTimer.current !== null) {
        globalThis.clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }

      return;
    }

    const target = stageOf(
      document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-stage]")
        ?.dataset.stage,
    );

    if (target !== null) {
      setHoverStage(target);
    }
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (holdTimer.current !== null) {
      globalThis.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }

    const target = stageOf(
      document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-stage]")
        ?.dataset.stage,
    );

    const dragged = dragCard.current;
    const heldCard = held.current;

    if (dragged !== null && dragging.current && target !== null) {
      move(dragged, target);
      suppressClick.current = true;
    }

    if (heldCard !== null) {
      const card = cards.find((candidate) => candidate.id === heldCard);

      if (card !== undefined && target !== null) {
        move(card, target);
      }

      suppressClick.current = true;
    }

    dragCard.current = null;
    dragging.current = false;
    held.current = null;
    setDraggingId(null);
    setHoldingId(null);
    setHoverStage(null);
    holdStart.current = null;
  };

  const archive = () => {
    if (detail === null) {
      return;
    }

    if (detail.application.stage !== "queued") {
      showToast(copy.board.archiveOnlyQueued);

      return;
    }

    withdraw.mutate(detail.application.id, {
      onSuccess: () => {
        setSelectedId(null);
      },
    });
  };

  const counts: Record<StageKey, number> = {
    applied: 0,
    closed: 0,
    interviewing: 0,
    offer: 0,
    queued: 0,
    ready: 0,
    screening: 0,
  };

  for (const stage of STAGE_ORDER) {
    counts[stage] = columns.find((column) => column.stage === stage)?.cards.length ?? 0;
  }

  const phoneCards = columns.find((column) => column.stage === mobileStage)?.cards ?? [];

  const stageTotal =
    (board?.total ?? 0) - (columns.find((column) => column.stage === "ready")?.cards.length ?? 0);

  return (
    <div className="board">
      <div className="hidden flex-1 flex-col pt-[26px] pb-7 pl-8 md:flex">
        <BoardPageHeader
          onToggleRunning={() => {
            running.mutate(home?.running !== true);
          }}
          running={home?.running ?? true}
          total={stageTotal}
        />
        {board === undefined || board.total === 0 ? (
          <div className="mt-7 rounded-lg border border-border bg-card p-6 shadow-sh">
            <p className="text-sm text-muted-foreground">{copy.board.emptyColumn}</p>
          </div>
        ) : (
          <div
            className="cols mt-[26px] flex flex-1 items-start gap-4 overflow-x-auto pr-8 pt-1 pb-3.5"
            data-scroll-region
          >
            {STAGE_ORDER.map((stage) => (
              <BoardColumn
                cards={columns.find((column) => column.stage === stage)?.cards ?? []}
                draggingId={draggingId}
                key={stage}
                onOpen={open}
                onPointerCancel={endDrag}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onSend={() => {
                  void navigate("/ready");
                }}
                onStageKey={onKey}
                selectedId={selectedId}
                stage={stage}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex h-[calc(100dvh-64px)] flex-col md:hidden">
        <BoardMobileHeader />
        <div className="px-5">
          <p className="serif text-[14px] text-muted-foreground italic">
            {copy.board.lead(stageTotal)}
          </p>
          <h1 className="serif text-[36px] leading-[1.05]">
            {copy.board.titlePlain} <span className="italic">{copy.board.titleItalic}</span>
          </h1>
        </div>
        <BoardStagePills
          counts={counts}
          hoverStage={hoverStage}
          onSelect={setMobileStage}
          selected={mobileStage}
        />
        <div
          aria-label={copy.board.columns[mobileStage]}
          className="mt-3 flex flex-1 touch-pan-y flex-col gap-3 overflow-y-auto px-5 pb-4"
          onPointerDown={(event) => {
            swipeStart.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = swipeStart.current;

            swipeStart.current = null;

            if (start === null || held.current !== null || dragging.current) {
              return;
            }

            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;

            if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) {
              return;
            }

            suppressClick.current = true;
            setMobileStage((current) => {
              const index = STAGE_ORDER.indexOf(current);
              const next = STAGE_ORDER[index + (dx < 0 ? 1 : -1)];

              return next ?? current;
            });
          }}
          role="tabpanel"
        >
          {phoneCards.map((card) => (
            <BoardPhoneCard
              card={card}
              holding={holdingId === card.id}
              key={card.id}
              onOpen={() => {
                open(card.id);
              }}
              onPointerCancel={endDrag}
              onPointerDown={(event) => {
                startDrag(card, event);
              }}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              selected={selectedId === card.id}
            />
          ))}
        </div>
      </div>

      {selectedId === null ? null : (
        <BoardSheet
          detail={detail}
          nextDisabled={selectedIndex === -1 || selectedIndex >= cards.length - 1}
          onArchive={archive}
          onClose={() => {
            setSelectedId(null);
          }}
          onMove={(stage) => {
            if (detail !== null) {
              moveTo(detail.application.id, stage);
            }
          }}
          onNext={() => {
            const next = cards[selectedIndex + 1];

            if (next !== undefined) {
              setSelectedId(next.id);
            }
          }}
          onPrevious={() => {
            const previous = cards[selectedIndex - 1];

            if (previous !== undefined) {
              setSelectedId(previous.id);
            }
          }}
          previousDisabled={selectedIndex <= 0}
        />
      )}

      {toast === null ? null : (
        <div
          aria-live="polite"
          className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border border-input bg-card py-1 pr-1 pl-4 text-[13px] font-semibold shadow-lift md:bottom-6"
        >
          <span>{toast.message}</span>
          {toast.undoId === null ? null : (
            <button
              className="toast-act"
              onClick={() => {
                if (toast.undoId !== null) {
                  undoMove(toast.undoId);
                }
              }}
              type="button"
            >
              {copy.board.undo}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
