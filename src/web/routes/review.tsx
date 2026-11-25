import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import type { ReviewCategory } from "../../shared/questions";

import { copy } from "../../shared/copy.ts";
import { REVIEW_CATEGORIES } from "../../shared/questions.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ReviewAnswerDrawer } from "../components/review-answer-drawer.tsx";
import { ReviewFilters } from "../components/review-filters.tsx";
import { ReviewTable } from "../components/review-table.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { MetricStrip } from "../components/ui/metric-strip.tsx";
import type { MetricStripItem } from "../components/ui/metric-strip.tsx";
import { dismissReview, useReviews } from "../lib/review-api.ts";
import type { Review } from "../lib/review-api.ts";

type Filter = ReviewCategory | "all";

function isReviewCategory(value: string | null): value is ReviewCategory {
  return REVIEW_CATEGORIES.some((category) => category === value);
}

function nextIdAfterRemoval(reviews: readonly Review[], removingId: string) {
  const index = reviews.findIndex((review) => review.id === removingId);

  if (index === -1) {
    return null;
  }

  return reviews.at(index + 1)?.id ?? reviews.at(index - 1)?.id ?? null;
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const { data, isError, isPending, refetch } = useReviews();
  const [resolvedIds, setResolvedIds] = useState<readonly string[]>([]);
  const [dismissingIds, setDismissingIds] = useState<readonly string[]>([]);

  const reviews = (data?.reviews ?? []).filter(
    (review) => !resolvedIds.includes(review.id) && !dismissingIds.includes(review.id),
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get("filter");
  const filter: Filter = isReviewCategory(filterParam) ? filterParam : "all";
  const questionId = searchParams.get("question");

  const writeParam = (changes: Record<string, string | null>, replace: boolean) => {
    const next = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }

    setSearchParams(next, { replace });
  };

  let totalApplications = 0;
  const companyNames = new Set<string>();
  const topics = new Set<string>();

  for (const review of reviews) {
    totalApplications += review.unlocked;
    topics.add(review.category);

    for (const app of review.applications) {
      companyNames.add(app.company);
    }
  }

  const companyCount = companyNames.size > 0 ? companyNames.size : reviews.length;

  const filtered =
    filter === "all" ? reviews : reviews.filter((review) => review.category === filter);

  const activeIndex =
    questionId === null ? -1 : filtered.findIndex((review) => review.id === questionId);

  const activeReview = activeIndex >= 0 ? (filtered.at(activeIndex) ?? null) : null;
  const sessionTotal = resolvedIds.length + reviews.length;

  const answeredProgress =
    sessionTotal === 0 ? 100 : Math.round((resolvedIds.length / sessionTotal) * 100);

  const metricItems: MetricStripItem[] = [
    {
      detail:
        reviews.length === 0
          ? copy.review.metrics.allClear
          : copy.review.metrics.topicsCount(topics.size),
      id: "open-questions",
      label: copy.review.metrics.openLabel,
      unit: copy.review.metrics.openUnit,
      value: String(reviews.length),
    },
    {
      detail: copy.review.metrics.companiesCount(companyCount),
      id: "blocked-apps",
      label: copy.review.metrics.blockedLabel,
      unit: copy.review.metrics.blockedUnit,
      value: String(totalApplications),
    },
    {
      detail:
        reviews.length === 0
          ? copy.review.metrics.allClear
          : copy.review.metrics.remainingCount(reviews.length),
      id: "answered",
      label: copy.review.metrics.answeredLabel,
      progress: answeredProgress,
      value:
        sessionTotal === 0
          ? copy.review.metrics.zeroQueue
          : `${String(resolvedIds.length)} / ${String(sessionTotal)}`,
    },
  ];

  const openReview = (review: Review) => {
    writeParam({ question: review.id }, false);
  };

  const stepDrawer = (delta: number) => {
    if (filtered.length <= 1 || activeIndex < 0) {
      return;
    }

    const next = filtered.at((activeIndex + delta + filtered.length) % filtered.length);

    if (next !== undefined) {
      writeParam({ question: next.id }, true);
    }
  };

  const closeDrawer = () => {
    writeParam({ question: null }, true);
  };

  const handleResolved = (id: string) => {
    setResolvedIds((current) => (current.includes(id) ? current : [...current, id]));

    if (questionId === id) {
      writeParam({ question: nextIdAfterRemoval(filtered, id) }, true);
    }
  };

  const dismissInline = async (review: Review) => {
    setDismissingIds((current) =>
      current.includes(review.id) ? current : [...current, review.id],
    );

    try {
      await dismissReview(review.id);
      handleResolved(review.id);
      toast.success(copy.review.dismissedToast);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reviews"] }),
        queryClient.invalidateQueries({ queryKey: ["home"] }),
        queryClient.invalidateQueries({ queryKey: ["board"] }),
        queryClient.invalidateQueries({ queryKey: ["ready"] }),
        queryClient.invalidateQueries({ queryKey: ["nav"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-facts"] }),
      ]);
    } catch {
      toast.error(copy.review.dismissFailed);
    }

    setDismissingIds((current) => current.filter((id) => id !== review.id));
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        actions={
          !isPending && !isError && reviews.length > 0 ? (
            <ReviewFilters
              active={filter}
              onChange={(category) => {
                const keepsSelection = reviews.some(
                  (review) => review.id === questionId && review.category === category,
                );

                writeParam(
                  category === "all" || keepsSelection
                    ? { filter: category }
                    : { filter: category, question: null },
                  true,
                );
              }}
              reviews={reviews}
            />
          ) : undefined
        }
        titleNode={`${copy.review.title} ${copy.review.titleAccent}`}
      />

      {!isPending && !isError ? (
        <MetricStrip ariaLabel={copy.review.summaryAria} className="mt-3" items={metricItems} />
      ) : null}

      {isPending ? (
        <Card ariaBusy className="mt-3 p-6">
          <div className="animate-pulse space-y-3">
            <span className="sr-only">{copy.shell.loadingPage}</span>
            <div className="h-5 w-1/3 rounded bg-muted" />
            <div className="h-24 w-full rounded bg-muted" />
          </div>
        </Card>
      ) : null}

      {isError ? (
        <Card className="mt-3 flex flex-wrap items-center justify-between gap-4 p-6">
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

      {!isPending && !isError && filtered.length === 0 ? (
        <Card className="mt-3 p-6">
          <h2 className={dsCardTitle}>{copy.review.emptyTitle}</h2>
          <p className={`${dsBody} mt-2 max-w-prose`}>{copy.review.emptyBody}</p>
        </Card>
      ) : null}

      {!isPending && !isError && filtered.length > 0 ? (
        <ReviewTable
          activeId={activeReview?.id ?? null}
          dismissingIds={dismissingIds}
          onDismiss={(review) => {
            void dismissInline(review);
          }}
          onOpen={openReview}
          reviews={filtered}
        />
      ) : null}

      <ReviewAnswerDrawer
        count={filtered.length}
        index={Math.max(0, activeIndex)}
        onClose={closeDrawer}
        onNext={() => {
          stepDrawer(1);
        }}
        onPrev={() => {
          stepDrawer(-1);
        }}
        onResolved={handleResolved}
        review={activeReview}
      />
    </div>
  );
}
