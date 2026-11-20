import type { Review } from "../lib/review-api";

import { copy } from "../../shared/copy.ts";

function companyLine(review: Review) {
  const names = review.applications.map((application) => application.company);
  const shown = names.slice(0, 2).join(", ");

  return names.length > 2 ? `${shown} +${String(names.length - 2)}` : shown;
}

export function ReviewRow({
  review,
  rank,
  selected,
  onSelect,
}: {
  review: Review;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`flex min-h-[72px] w-full items-center gap-3.5 rounded-lg border px-3.5 py-3.5 text-left text-foreground max-md:min-h-[76px] ${
        selected
          ? "border-foreground bg-background shadow-sh ring-1 ring-foreground"
          : "border-transparent hover:bg-muted"
      }`}
      onClick={onSelect}
      type="button"
    >
      <span className="w-[22px] flex-none font-serif text-[30px] italic leading-none text-need">
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-[1.35]">{review.prompt}</span>
        <span className="mt-px block text-[12.5px] text-muted-foreground">
          {copy.review.categories[review.category]}
          {" · "}
          {companyLine(review)}
        </span>
      </span>
      <span className="flex-none text-right">
        <span className="block font-serif text-[26px] leading-none tabular-nums">
          {review.unlocked}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {copy.review.unlocked(review.unlocked)}
        </span>
      </span>
    </button>
  );
}
