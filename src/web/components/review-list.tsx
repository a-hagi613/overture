import type { Review } from "../lib/review-api";

import { copy } from "../../shared/copy.ts";
import { ReviewRow } from "./review-row.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

export function ReviewList({
  mobileVisible = false,
  reviews,
  selectedId,
  onSelect,
}: {
  mobileVisible?: boolean;
  reviews: readonly Review[];
  selectedId: string | null;
  onSelect: (reviewId: string) => void;
}) {
  return (
    <Card
      className={
        mobileVisible
          ? "min-w-0 flex-[1_1_360px] p-4"
          : "min-w-0 flex-[1_1_360px] p-4 max-md:hidden"
      }
    >
      <div className="px-2 pb-2 pt-1">
        <h2 className={dsCardTitle}>{copy.review.listTitle}</h2>
        <p className={`${dsBody} mt-1 text-xs`}>{copy.review.listNote}</p>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {reviews.map((review) => (
          <ReviewRow
            key={review.id}
            onSelect={() => {
              onSelect(review.id);
            }}
            review={review}
            selected={review.id === selectedId}
          />
        ))}
      </div>
    </Card>
  );
}
