import { useState } from "react";

import type { ReviewCategory } from "../../shared/questions";

import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ReviewDetail } from "../components/review-detail.tsx";
import { ReviewFilters } from "../components/review-filters.tsx";
import { ReviewList } from "../components/review-list.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { useReviews } from "../lib/review-api.ts";

type Filter = ReviewCategory | "all";

export function ReviewPage() {
  const { data, isError, isPending, refetch } = useReviews();
  const [resolvedIds, setResolvedIds] = useState<readonly string[]>([]);
  const reviews = (data?.reviews ?? []).filter((review) => !resolvedIds.includes(review.id));
  const totalApplications = reviews.reduce((sum, review) => sum + review.unlocked, 0);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const filtered =
    filter === "all" ? reviews : reviews.filter((review) => review.category === filter);

  const selected = filtered.find((review) => review.id === selectedId) ?? filtered.at(0) ?? null;
  const position = selected === null ? 0 : reviews.indexOf(selected) + 1;

  return (
    <div>
      <PageHeader
        lead={copy.review.lead(reviews.length, totalApplications)}
        titleNode={
          <>
            {copy.review.title} <em className="italic text-signal">{copy.review.titleAccent}</em>
          </>
        }
      />

      {isPending ? (
        <Card ariaBusy className="mt-6 p-6">
          <div className="animate-pulse space-y-3">
            <span className="sr-only">{copy.shell.loadingPage}</span>
            <div className="h-5 w-1/3 rounded bg-muted" />
            <div className="h-24 w-full rounded bg-muted" />
          </div>
        </Card>
      ) : null}

      {isError ? (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-6">
          <p className="text-sm font-semibold text-foreground" role="alert">
            {copy.review.loadFailed}
          </p>
          <Button
            onClick={() => {
              void refetch();
            }}
            size="sm"
            variant="outline"
          >
            {copy.inbox.retry}
          </Button>
        </Card>
      ) : null}

      {!isPending && !isError ? (
        <>
          <div className="mt-6">
            <ReviewFilters active={filter} onChange={setFilter} reviews={reviews} />
          </div>

          {selected === null ? (
            <Card className="mt-5 p-6">
              <h2 className={dsCardTitle}>{copy.review.emptyTitle}</h2>
              <p className={`${dsBody} mt-2 max-w-[60ch]`}>{copy.review.emptyBody}</p>
            </Card>
          ) : (
            <div className="mt-5 flex flex-wrap items-start gap-5">
              <ReviewList
                mobileVisible={mobileListOpen}
                onSelect={(id) => {
                  setSelectedId(id);
                  setMobileListOpen(false);
                }}
                reviews={filtered}
                selectedId={selected.id}
              />
              <ReviewDetail
                hiddenOnMobile={mobileListOpen}
                key={selected.id}
                onBack={() => {
                  setMobileListOpen(true);
                }}
                onResolved={(id) => {
                  setResolvedIds((current) => [...current, id]);
                  setSelectedId(null);
                  setMobileListOpen(false);
                }}
                position={position}
                review={selected}
                total={reviews.length}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
