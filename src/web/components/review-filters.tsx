import type { Review } from "../lib/review-api";
import type { ReviewCategory } from "../../shared/questions";

import { copy } from "../../shared/copy.ts";
import { REVIEW_CATEGORIES } from "../../shared/questions.ts";

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
      className="m-0 flex min-h-9 min-w-0 flex-nowrap gap-2 overflow-x-auto border-0 p-0 max-md:-mx-4 max-md:px-4 max-md:py-0.5 md:flex-wrap md:overflow-visible"
    >
      {FILTER_ORDER.flatMap((category) => {
        const count = counts.get(category) ?? 0;

        if (category !== "all" && count === 0) {
          return [];
        }

        const selected = category === active;
        const label = category === "all" ? copy.review.all : copy.review.categories[category];

        return [
          <button
            aria-pressed={selected}
            className={`inline-flex min-h-9 flex-none items-center gap-2 whitespace-nowrap rounded-full border px-[14px] text-[13px] font-semibold max-md:min-h-11 ${
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-input bg-card text-foreground hover:bg-muted"
            }`}
            key={category}
            onClick={() => {
              onChange(category);
            }}
            type="button"
          >
            <span>{label}</span> <b className="text-[11.5px] font-bold opacity-[.78]">{count}</b>
          </button>,
        ];
      })}
    </fieldset>
  );
}
