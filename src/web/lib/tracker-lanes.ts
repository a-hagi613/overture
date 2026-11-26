import { copy } from "../../shared/copy.ts";
import type { BoardCard, BoardResponse, StageKey } from "./board-api.ts";

export type TrackerLaneKey = "queue" | "applied" | "interviews" | "closed";

export const MOBILE_TAB_PREFIX = "tab:";

export interface CardBadge {
  label: string;
  variant: "ok" | "outline" | "secondary" | "signal" | "need";
}

/**
 * The Tracker's three visible columns plus the filtered Closed group.
 *
 * Queue groups the Queued and Ready stages (Preparing through Confirming), Applied is the sent
 * stage, and Interviews groups Screening · Interviewing · Offer. Closed, Cancelled and Not sent
 * share the last lane and stay behind the "Show closed" toggle.
 */
export const TRACKER_LANES: readonly {
  dotClass: string;
  droppable: boolean;
  key: TrackerLaneKey;
  label: string;
  targetStage: StageKey;
}[] = [
  {
    dotClass: "bg-foreground",
    droppable: false,
    key: "queue",
    label: copy.board.lanes.queue,
    targetStage: "ready",
  },
  {
    dotClass: "bg-signal",
    droppable: true,
    key: "applied",
    label: copy.board.lanes.applied,
    targetStage: "applied",
  },
  {
    dotClass: "bg-ok",
    droppable: true,
    key: "interviews",
    label: copy.board.lanes.interviews,
    targetStage: "screening",
  },
  {
    dotClass: "bg-muted-foreground/40",
    droppable: true,
    key: "closed",
    label: copy.board.lanes.closed,
    targetStage: "closed",
  },
];

export function isTrackerLaneKey(value: string): value is TrackerLaneKey {
  return value === "queue" || value === "applied" || value === "interviews" || value === "closed";
}

export function laneForStage(stage: StageKey | null) {
  let lane: TrackerLaneKey | null = null;

  if (stage === "queued" || stage === "ready") {
    lane = "queue";
  } else if (stage === "applied") {
    lane = "applied";
  } else if (stage === "screening" || stage === "interviewing" || stage === "offer") {
    lane = "interviews";
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
    interviews: [],
    queue: [],
  };

  if (board === undefined) {
    return grouped;
  }

  const add = (card: BoardCard, baseLane: TrackerLaneKey) => {
    const effectiveLane = overrides[card.id] ?? baseLane;
    const laneInfo = TRACKER_LANES.find((entry) => entry.key === effectiveLane);

    const updatedCard =
      effectiveLane === baseLane || laneInfo === undefined
        ? card
        : { ...card, stage: laneInfo.targetStage };

    grouped[effectiveLane].push(updatedCard);
  };

  for (const column of board.columns) {
    const baseLane = laneForStage(column.stage);

    if (baseLane !== null) {
      for (const card of column.cards) {
        add(card, baseLane);
      }
    }
  }

  for (const card of board.hidden) {
    add(card, "closed");
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

function queueBadge(card: BoardCard) {
  let result: CardBadge | null = null;

  switch (card.status) {
    case "preparing": {
      result = { label: copy.board.queueBadges.preparing, variant: "secondary" };
      break;
    }

    case "needs_review": {
      result = { label: copy.board.queueBadges.needsAnswer, variant: "need" };
      break;
    }

    case "ready": {
      result = { label: copy.board.queueBadges.ready, variant: "ok" };
      break;
    }

    case "approved": {
      result = {
        label:
          card.sendsAt === null
            ? copy.board.queueBadges.queuedNext
            : copy.board.queueBadges.queuedAt(card.sendsAt),
        variant: "outline",
      };
      break;
    }

    case "sending": {
      result = { label: copy.board.queueBadges.sending, variant: "signal" };
      break;
    }

    case "confirming": {
      result = { label: copy.board.queueBadges.confirming, variant: "signal" };
      break;
    }

    default: {
      break;
    }
  }

  if (result !== null) {
    return result;
  }

  return card.needsYou
    ? ({ label: copy.board.queueBadges.needsAnswer, variant: "need" } satisfies CardBadge)
    : null;
}

export function cardBadgeFor(card: BoardCard, lane: TrackerLaneKey) {
  let result: CardBadge = { label: copy.board.appliedBadge, variant: "secondary" };

  if (lane === "queue") {
    result = queueBadge(card) ?? { label: copy.board.queuedBadge, variant: "outline" };
  } else if (lane === "interviews") {
    if (card.stage === "offer") {
      result = { label: copy.board.waitingStages.offer, variant: "signal" };
    } else if (card.stage === "interviewing") {
      result = { label: copy.board.waitingStages.interviewing, variant: "ok" };
    } else {
      result = { label: copy.board.waitingStages.screening, variant: "secondary" };
    }
  } else if (lane === "closed") {
    if (card.status === "skipped" || card.status === "failed") {
      result = { label: copy.board.notSentBadge, variant: "outline" };
    } else if (card.status === "withdrawn") {
      result = { label: copy.board.cancelledBadge, variant: "outline" };
    } else {
      result = { label: card.note?.label ?? copy.board.closedBadge, variant: "outline" };
    }
  } else if (card.note !== null) {
    result = { label: card.note.label, variant: "secondary" };
  }

  return result;
}
