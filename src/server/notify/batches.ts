import { copy } from "../../shared/copy.ts";
import type { NotificationKind } from "../../shared/notifications.ts";

export interface NotificationBatchCopy {
  /** The message for a row that now covers `count` events (always two or more). */
  body: string;
  title: (count: number) => string;
  /** The page the batched row opens; the single row keeps its own link. */
  url?: string;
}

/**
 * The kinds that arrive in bursts, and the copy a merged row uses. A kind left
 * out is written as it arrives: an urgent one (a code to paste, sending paused)
 * or one the hourly and daily jobs already collapse (failed, ready).
 */
export const NOTIFICATION_BATCH_COPY: Partial<Record<NotificationKind, NotificationBatchCopy>> = {
  interview: copy.notifications.interview.batch,
  offer: copy.notifications.offer.batch,
  reply: copy.notifications.reply.batch,
  review: copy.notifications.review.batch,
  stage_move: copy.notifications.stageMove.batch,
};
