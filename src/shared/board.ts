export const BOARD_STAGES = [
  "queued",
  "ready",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "closed",
] as const;

export type BoardStage = (typeof BOARD_STAGES)[number];

export const BOARD_MOVE_STAGES = [
  "applied",
  "screening",
  "interviewing",
  "offer",
  "closed",
] as const;

export type BoardMoveStage = (typeof BOARD_MOVE_STAGES)[number];

export const WITHDRAWABLE_APPLICATION_STATUSES = [
  "preparing",
  "needs_review",
  "ready",
  "approved",
] as const;

export type WithdrawableApplicationStatus = (typeof WITHDRAWABLE_APPLICATION_STATUSES)[number];

export function isBoardMoveStage(value: string): value is BoardMoveStage {
  return BOARD_MOVE_STAGES.some((stage) => stage === value);
}

export function canMoveApplicationToStage(status: string, stage: BoardStage) {
  if (status === "preparing" || status === "needs_review") {
    return stage === "applied" || stage === "queued";
  }

  return status === "sent" && isBoardMoveStage(stage);
}

export function canWithdrawApplication(status: string) {
  return WITHDRAWABLE_APPLICATION_STATUSES.some((candidate) => candidate === status);
}
