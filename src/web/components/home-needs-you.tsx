import { Link } from "react-router";

import type { HomeReviewRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";

function companyLine(review: HomeReviewRow) {
  const names = review.companies.join(", ");
  const more = review.companyCount - review.companies.length;

  return more > 0 ? `${names} +${String(more)}` : names;
}

export function HomeNeedsYou(props: {
  applications: number;
  reviews: readonly HomeReviewRow[];
  total: number;
}) {
  const { applications, reviews, total } = props;

  return (
    <section
      aria-labelledby="home-needs-you"
      className="min-w-0 flex-[1_1_380px] rounded-lg border border-border bg-card px-4 pb-2 pt-[22px] shadow-sh min-[768px]:px-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-[26px] leading-[1.5]" id="home-needs-you">
            {copy.home.needsYou.title}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">
            {copy.home.needsYou.note}
          </p>
        </div>
        <span className="font-serif text-sm italic text-muted-foreground">
          {copy.home.needsYou.fig}
        </span>
      </div>
      <div className="mt-3">
        {reviews.map((review, index) => (
          <div
            className="flex items-center gap-3.5 border-t border-border py-3.5 first:border-t-0"
            key={review.id}
          >
            <span
              aria-hidden="true"
              className="w-[22px] flex-none font-serif text-[30px] italic leading-none text-need"
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-[1.35]">{review.prompt}</p>
              <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
                {companyLine(review)}
              </p>
            </div>
            <div className="w-[74px] flex-none text-right">
              <p className="font-serif text-[26px] leading-none tabular-nums">{review.unlocked}</p>
              <p className="whitespace-nowrap text-[11px] leading-[1.5] text-muted-foreground">
                {copy.home.needsYou.jobsUnlocked(review.unlocked)}
              </p>
            </div>
          </div>
        ))}
        {reviews.length === 0 ? (
          <p className="border-t border-border py-3.5 text-sm text-muted-foreground">
            {copy.home.needsYou.empty}
          </p>
        ) : null}
      </div>
      {total > 0 ? (
        <div className="-mx-4 mt-1.5 flex items-center justify-between gap-3 border-t border-border px-4 py-3.5 min-[768px]:-mx-6 min-[768px]:px-6">
          <span className="text-[12.5px] leading-[1.5] text-muted-foreground">
            {copy.home.needsYou.footer(total, applications)}
          </span>
          <Link
            className="inline-flex min-h-9 flex-none items-center justify-center rounded-md border border-foreground bg-foreground px-3.5 text-[13.5px] font-semibold text-primary-ink hover:bg-btn-hover"
            to="/review"
          >
            {copy.home.needsYou.open}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
