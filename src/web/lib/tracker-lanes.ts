import { copy } from "../../shared/copy.ts";
import type { BoardCard, BoardResponse, StageKey } from "./board-api.ts";

export type TrackerLaneKey = "review" | "ready" | "applied" | "waiting" | "closed";

export const MOBILE_TAB_PREFIX = "tab:";

export interface CardBadge {
  label: string;
  variant: "ok" | "outline" | "secondary" | "signal";
}

export const TRACKER_LANES: readonly {
  dotClass: string;
  droppable: boolean;
  key: TrackerLaneKey;
  label: string;
  linkTo: string | null;
  targetStage: StageKey;
}[] = [
  {
    dotClass: "bg-muted-foreground/60",
    droppable: false,
    key: "review",
    label: copy.board.lanes.review,
    linkTo: "/review",
    targetStage: "queued",
  },
  {
    dotClass: "bg-ok",
    droppable: false,
    key: "ready",
    label: copy.board.lanes.ready,
    linkTo: "/ready",
    targetStage: "ready",
  },
  {
    dotClass: "bg-signal",
    droppable: true,
    key: "applied",
    label: copy.board.lanes.applied,
    linkTo: null,
    targetStage: "applied",
  },
  {
    dotClass: "bg-foreground",
    droppable: true,
    key: "waiting",
    label: copy.board.lanes.waiting,
    linkTo: null,
    targetStage: "screening",
  },
  {
    dotClass: "bg-muted-foreground/40",
    droppable: true,
    key: "closed",
    label: copy.board.lanes.closed,
    linkTo: null,
    targetStage: "closed",
  },
];

export function isTrackerLaneKey(value: string): value is TrackerLaneKey {
  return (
    value === "review" ||
    value === "ready" ||
    value === "applied" ||
    value === "waiting" ||
    value === "closed"
  );
}

export function laneForStage(stage: StageKey | null) {
  let lane: TrackerLaneKey | null = null;

  if (stage === "queued") {
    lane = "review";
  } else if (stage === "ready") {
    lane = "ready";
  } else if (stage === "applied") {
    lane = "applied";
  } else if (stage === "screening" || stage === "interviewing" || stage === "offer") {
    lane = "waiting";
  } else if (stage === "closed") {
    lane = "closed";
  }

  return lane;
}

export function groupCardsByLane(
  board: BoardResponse | undefined,
  overrides: Readonly<Record<string, TrackerLaneKey>>,
) {
  const grouped: Record<TrackerLaneKey, BoardCard[]> = {
    applied: [],
    closed: [],
    ready: [],
    review: [],
    waiting: [],
  };

  if (board === undefined) {
    return grouped;
  }

  for (const column of board.columns) {
    const baseLane = laneForStage(column.stage);

    if (baseLane !== null) {
      for (const card of column.cards) {
        const effectiveLane = overrides[card.id] ?? baseLane;
        const laneInfo = TRACKER_LANES.find((entry) => entry.key === effectiveLane);

        const updatedCard =
          effectiveLane === baseLane || laneInfo === undefined
            ? card
            : { ...card, stage: laneInfo.targetStage };

        grouped[effectiveLane].push(updatedCard);
      }
    }
  }

  return grouped;
}

export function formatCardSalary(card: BoardCard) {
  const currency = card.salary?.currency ?? null;

  if (card.salary === null || currency === null) {
    return null;
  }

  const period = card.salary.period ?? "year";
  let divisor = 100;
  let suffix = "/hr";

  if (period === "year") {
    divisor = 100_000;
    suffix = "k";
  } else if (period === "month") {
    suffix = "/mo";
  }

  const minimum = String(Math.round(card.salary.minMinor / divisor));

  const maximum =
    card.salary.maxMinor === null ? null : String(Math.round(card.salary.maxMinor / divisor));

  return copy.board.salary(minimum, maximum, currency, suffix);
}

export function cardBadgeFor(card: BoardCard, lane: TrackerLaneKey) {
  let result: CardBadge = { label: copy.board.appliedBadge, variant: "secondary" };

  if (lane === "review") {
    result = card.needsYou
      ? { label: copy.board.needsAnswerBadge, variant: "signal" }
      : { label: copy.board.queuedBadge, variant: "outline" };
  } else if (lane === "ready") {
    result = { label: copy.board.readyBadge, variant: "ok" };
  } else if (lane === "waiting") {
    if (card.stage === "offer") {
      result = { label: copy.board.waitingStages.offer, variant: "signal" };
    } else if (card.stage === "interviewing") {
      result = { label: copy.board.waitingStages.interviewing, variant: "ok" };
    } else {
      result = { label: copy.board.waitingStages.screening, variant: "secondary" };
    }
  } else if (lane === "closed") {
    result = { label: card.note?.label ?? copy.board.closedBadge, variant: "outline" };
  } else if (card.note !== null) {
    result = { label: card.note.label, variant: "secondary" };
  }

  return result;
}
