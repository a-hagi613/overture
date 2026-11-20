import type { Review } from "../lib/review-api";

import { copy } from "../../shared/copy.ts";
import { ReviewRow } from "./review-row.tsx";

export function ReviewList({
  reviews,
  selectedId,
  onSelect,
}: {
  reviews: readonly Review[];
  selectedId: string | null;
  onSelect: (reviewId: string) => void;
}) {
  const many = reviews.filter((review) => review.unlocked >= 3);
  const few = reviews.filter((review) => review.unlocked < 3);

  return (
    <div className="min-w-0 flex-[1_1_360px] rounded-lg border border-border bg-card px-3 pb-3 pt-5 shadow-sh max-md:hidden">
      <div className="flex items-baseline justify-between gap-3 px-3">
        <div>
          <h2 className="font-serif text-[26px] leading-[1.15]">{copy.review.listTitle}</h2>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">
            {copy.review.listNote}
          </p>
        </div>
        <span className="font-serif text-sm italic text-muted-foreground">
          {copy.review.figList}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        {many.length > 0 ? (
          <>
            <p className="px-3.5 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase leading-[13px] tracking-[.15em] text-muted-foreground">
              {copy.review.groupMany}
            </p>
            {many.map((review) => (
              <ReviewRow
                key={review.id}
                onSelect={() => {
                  onSelect(review.id);
                }}
                rank={reviews.indexOf(review) + 1}
                review={review}
                selected={review.id === selectedId}
              />
            ))}
          </>
        ) : null}
        {few.length > 0 ? (
          <>
            {many.length > 0 ? (
              <p className="px-3.5 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase leading-[13px] tracking-[.15em] text-muted-foreground">
                {copy.review.groupFew}
              </p>
            ) : null}
            {few.map((review) => (
              <ReviewRow
                key={review.id}
                onSelect={() => {
                  onSelect(review.id);
                }}
                rank={reviews.indexOf(review) + 1}
                review={review}
                selected={review.id === selectedId}
              />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
