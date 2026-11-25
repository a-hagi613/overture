import { copy } from "../../shared/copy.ts";
import type { Review } from "../lib/review-api.ts";
import { ReviewTableRow } from "./review-table-row.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow, dsMono } from "./ui/ds.ts";

/**
 * Stripe/Ramp-style structured action table listing every Review question waiting for input,
 * with waiting employers, topic category, unblock count, and inline Answer / Dismiss actions.
 * @param props Table state and row callbacks.
 * @param props.activeId Question currently open in the slide-over answer drawer, or `null`.
 * @param props.dismissingIds Question ids currently being dismissed inline.
 * @param props.onDismiss Invoked when Dismiss is clicked on a row.
 * @param props.onOpen Invoked when opening a question in the answer drawer.
 * @param props.reviews Filtered list of open Review questions.
 * @returns Review action table card.
 */
export function ReviewTable({
  activeId,
  dismissingIds,
  onDismiss,
  onOpen,
  reviews,
}: {
  activeId: string | null;
  dismissingIds: readonly string[];
  onDismiss: (review: Review) => void;
  onOpen: (review: Review) => void;
  reviews: readonly Review[];
}) {
  return (
    <Card
      ariaLabel={copy.review.queueAria}
      className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
      variant="default"
    >
      <div className="hidden border-b border-border bg-sidebar/40 px-5 py-2.5 lg:flex lg:items-center lg:gap-4">
        <span className={`${dsEyebrow} lg:min-w-0 lg:flex-1`}>{copy.review.table.questionCol}</span>
        <span className={`${dsEyebrow} lg:w-36 lg:shrink-0 xl:w-40`}>
          {copy.review.table.topicCol}
        </span>
        <span className={`${dsEyebrow} lg:w-36 lg:shrink-0 xl:w-40`}>
          {copy.review.table.unlocksCol}
        </span>
        <span className={`${dsEyebrow} text-right lg:w-48 lg:shrink-0`}>
          {copy.review.table.actionsCol}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="divide-y divide-border lg:absolute lg:inset-0 lg:overflow-y-auto"
          data-scroll-region
        >
          {reviews.map((review) => (
            <ReviewTableRow
              active={review.id === activeId}
              busy={dismissingIds.includes(review.id)}
              key={review.id}
              onDismiss={onDismiss}
              onOpen={onOpen}
              review={review}
            />
          ))}
        </div>
      </div>

      <div className="hidden shrink-0 items-center justify-between gap-3 border-t border-border bg-sidebar/30 px-5 py-2 text-xs text-muted-foreground lg:flex">
        <span>{copy.review.table.footerHint}</span>
        <span className={dsMono}>{copy.review.table.shortcuts}</span>
      </div>
    </Card>
  );
}
