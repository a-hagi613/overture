import { useState } from "react";

import type { ReviewCategory } from "../../shared/questions";

import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ReviewDetail } from "../components/review-detail.tsx";
import { ReviewFilters } from "../components/review-filters.tsx";
import { ReviewList } from "../components/review-list.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { useReviews } from "../lib/review-api.ts";

type Filter = ReviewCategory | "all";

export function ReviewPage() {
  const { data } = useReviews();
  const [resolvedIds, setResolvedIds] = useState<readonly string[]>([]);
  const reviews = (data?.reviews ?? []).filter((review) => !resolvedIds.includes(review.id));
  const totalApplications = reviews.reduce((sum, review) => sum + review.unlocked, 0);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
          <ReviewList onSelect={setSelectedId} reviews={filtered} selectedId={selected.id} />
          <ReviewDetail
            key={selected.id}
            onResolved={(id) => {
              setResolvedIds((current) => [...current, id]);
              setSelectedId(null);
            }}
            position={position}
            review={selected}
            total={reviews.length}
          />
        </div>
      )}
    </div>
  );
}
