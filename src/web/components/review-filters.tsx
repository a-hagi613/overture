import type { ReviewCategory } from "../../shared/questions";
import type { Review } from "../lib/review-api";

import { copy } from "../../shared/copy.ts";
import { REVIEW_CATEGORIES } from "../../shared/questions.ts";
import { Button } from "./ui/button.tsx";

const FILTER_ORDER: readonly (ReviewCategory | "all")[] = ["all", ...REVIEW_CATEGORIES];

export function ReviewFilters({
  reviews,
  active,
  onChange,
}: {
  reviews: readonly Review[];
  active: ReviewCategory | "all";
  onChange: (category: ReviewCategory | "all") => void;
}) {
  const counts = new Map<ReviewCategory | "all", number>([["all", reviews.length]]);

  for (const review of reviews) {
    counts.set(review.category, (counts.get(review.category) ?? 0) + 1);
  }

  return (
    <fieldset
      aria-label={copy.review.filters}
      className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
    >
      {FILTER_ORDER.flatMap((category) => {
        const count = counts.get(category) ?? 0;

        if (category !== "all" && count === 0) {
          return [];
        }

        const selected = category === active;
        const label = category === "all" ? copy.review.all : copy.review.categories[category];

        return [
          <Button
            ariaPressed={selected}
            className="flex-none rounded-md max-md:min-h-11"
            key={category}
            onClick={() => {
              onChange(category);
            }}
            size="xs"
            variant={selected ? "primary" : "outline"}
          >
            <span>{label}</span>
            <span className="text-xs opacity-75 tabular-nums">{count}</span>
          </Button>,
        ];
      })}
    </fieldset>
  );
}
