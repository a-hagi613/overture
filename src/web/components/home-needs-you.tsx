import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import type { HomeReviewRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { PanelEmpty } from "./ui/panel-empty.tsx";
import { PanelHeader } from "./ui/panel-header.tsx";
import { PanelList } from "./ui/panel-list.tsx";

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
  const preview = reviews.slice(0, 3);

  const countBadge =
    total > 0 ? (
      <Badge className="tabular-nums" variant="need">
        {copy.home.needsYou.openCount(total)}
      </Badge>
    ) : undefined;

  return (
    <Card ariaLabelledBy="home-needs-you" className="flex h-full flex-col overflow-hidden">
      <PanelHeader
        action={countBadge}
        className="py-2.5"
        subtitle={copy.home.needsYou.note}
        title={copy.home.needsYou.title}
        titleId="home-needs-you"
      />

      {preview.length === 0 ? (
        <PanelEmpty title={copy.home.needsYou.empty} />
      ) : (
        <PanelList className="flex-1 py-0.5">
          {preview.map((review) => (
            <Link
              className="group -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2.5 transition hover:bg-muted"
              key={review.id}
              to="/review"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug text-foreground">{review.prompt}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {copy.home.needsYou.askedBy(companyLine(review))}
                </p>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground"
              />
            </Link>
          ))}
        </PanelList>
      )}
    </Card>
  );
}
