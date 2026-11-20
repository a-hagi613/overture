import { useState } from "react";

import type { ReviewCategory } from "../../shared/questions";

import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ReviewDetail } from "../components/review-detail.tsx";
import { ReviewFilters } from "../components/review-filters.tsx";
import { ReviewList } from "../components/review-list.tsx";
import { useReviews } from "../lib/review-api.ts";

type Filter = ReviewCategory | "all";

export function ReviewPage() {
  const { data } = useReviews();
  const reviews = data?.reviews ?? [];
  const totalApplications = data?.totalApplications ?? 0;
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
            {copy.review.title} <span className="italic">{copy.review.titleAccent}</span>
          </>
        }
      />
      <div className="mt-7 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <ReviewFilters active={filter} onChange={setFilter} reviews={reviews} />
        <p className="font-serif text-sm italic leading-[21px] text-muted-foreground">
          {copy.review.groupedBy}
        </p>
      </div>
      {selected === null ? (
        <section className="mt-4 rounded-lg border border-border bg-card p-6 shadow-sh">
          <h2 className="font-serif text-[26px] leading-[1.15]">{copy.review.emptyTitle}</h2>
          <p className="mt-2 max-w-[60ch] text-sm leading-[1.55] text-muted-foreground">
            {copy.review.emptyBody}
          </p>
        </section>
      ) : (
        <div className="mt-4 flex flex-wrap items-start gap-5">
          <ReviewList onSelect={setSelectedId} reviews={filtered} selectedId={selected.id} />
          <ReviewDetail
            key={selected.id}
            onResolved={() => {
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
