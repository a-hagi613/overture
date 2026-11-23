import { ArrowRight, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import type { HomeReviewRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

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
  const { reviews, total } = props;

  return (
    <Card ariaLabelledBy="home-needs-you" className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={dsCardTitle} id="home-needs-you">
            {copy.home.needsYou.title}
          </h2>
          <p className={`${dsBody} mt-0.5 text-xs`}>{copy.home.needsYou.note}</p>
        </div>
        {total > 0 ? (
          <Badge className="shrink-0 tabular-nums" variant="signal">
            {copy.home.needsYou.openCount(total)}
          </Badge>
        ) : null}
      </div>
      <div className="mt-4 flex flex-1 flex-col divide-y divide-border">
        {reviews.map((review) => (
          <Link
            className="group -mx-2 flex flex-1 items-center justify-between gap-4 rounded-lg px-2 py-4 transition hover:bg-muted"
            key={review.id}
            to="/review"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-foreground group-hover:text-signal-text">
                {review.prompt}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {copy.home.needsYou.askedBy(companyLine(review))}
              </p>
            </div>
            <ChevronRight
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground"
            />
          </Link>
        ))}
        {reviews.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">{copy.home.needsYou.empty}</p>
        ) : null}
      </div>
      {total > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <Button asChild className="w-full" size="default" variant="primary">
            <Link to="/review">
              {copy.home.needsYou.open}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
