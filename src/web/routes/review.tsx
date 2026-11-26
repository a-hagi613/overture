import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

import type { ReviewCategory } from "../../shared/questions";

import { copy } from "../../shared/copy.ts";
import { REVIEW_CATEGORIES } from "../../shared/questions.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ReviewApplicationCard } from "../components/review-application-card.tsx";
import { ReviewApplicationDrawer } from "../components/review-application-drawer.tsx";
import { ReviewFilters } from "../components/review-filters.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { MetricStrip } from "../components/ui/metric-strip.tsx";
import type { MetricStripItem } from "../components/ui/metric-strip.tsx";
import { groupReviewsByApplication, useReviews } from "../lib/review-api.ts";
import type { ReviewApplicationGroup } from "../lib/review-api.ts";

type Filter = ReviewCategory | "all";

function isReviewCategory(value: string | null): value is ReviewCategory {
  return REVIEW_CATEGORIES.some((category) => category === value);
}

function openQuestionsDetail(questionCount: number, sharedCount: number) {
  if (questionCount === 0) {
    return copy.review.metrics.allClear;
  }

  return sharedCount === 0
    ? copy.review.everyQuestionOnce
    : copy.review.applicationShared(sharedCount);
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const { data, isError, isPending, refetch } = useReviews();
  const [resolvedIds, setResolvedIds] = useState<readonly string[]>([]);

  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get("filter");
  const filter: Filter = isReviewCategory(filterParam) ? filterParam : "all";
  const applicationParam = searchParams.get("application");
  const questionParam = searchParams.get("question");

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

  const reviews = data?.reviews ?? [];

  const groups = groupReviewsByApplication(reviews).filter(
    (group) => !resolvedIds.includes(group.applicationId),
  );

  const filtered =
    filter === "all"
      ? groups
      : groups.filter((group) => group.questions.some((question) => question.category === filter));

  const legacyApplicationId =
    questionParam === null
      ? null
      : (reviews.find((review) => review.id === questionParam)?.applications.at(0)?.applicationId ??
        null);

  const requestedApplicationId = applicationParam ?? legacyApplicationId;

  const activeIndex =
    requestedApplicationId === null
      ? -1
      : filtered.findIndex((group) => group.applicationId === requestedApplicationId);

  const activeGroup = activeIndex >= 0 ? (filtered.at(activeIndex) ?? null) : null;

  const questionCount = reviews.length;
  const sharedCount = reviews.filter((review) => review.applications.length > 1).length;
  const sessionTotal = resolvedIds.length + groups.length;

  const answeredProgress =
    sessionTotal === 0 ? 100 : Math.round((resolvedIds.length / sessionTotal) * 100);

  const metricItems: MetricStripItem[] = [
    {
      detail: openQuestionsDetail(questionCount, sharedCount),
      id: "open-questions",
      label: copy.review.metrics.openLabel,
      unit: copy.review.metrics.openUnit,
      value: String(questionCount),
    },
    {
      id: "blocked-apps",
      label: copy.review.metrics.blockedLabel,
      unit: copy.review.metrics.blockedUnit,
      value: String(groups.length),
    },
    {
      detail:
        groups.length === 0
          ? copy.review.metrics.allClear
          : copy.review.metrics.remainingCount(groups.length),
      id: "answered",
      label: copy.review.metrics.answeredLabel,
      progress: answeredProgress,
      value:
        sessionTotal === 0
          ? copy.review.metrics.zeroQueue
          : `${String(resolvedIds.length)} / ${String(sessionTotal)}`,
    },
  ];

  const openGroup = (group: ReviewApplicationGroup) => {
    writeParam({ application: group.applicationId, question: null }, false);
  };

  const stepDrawer = (delta: number) => {
    if (filtered.length <= 1 || activeIndex < 0) {
      return;
    }

    const next = filtered.at((activeIndex + delta + filtered.length) % filtered.length);

    if (next !== undefined) {
      writeParam({ application: next.applicationId, question: null }, true);
    }
  };

  const closeDrawer = () => {
    writeParam({ application: null, question: null }, true);
  };

  const handleSaved = async (applicationId: string) => {
    setResolvedIds((current) =>
      current.includes(applicationId) ? current : [...current, applicationId],
    );

    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);

        if (next.get("application") === applicationId || next.get("question") !== null) {
          next.delete("application");
          next.delete("question");
        }

        return next;
      },
      { replace: true },
    );

    await queryClient.invalidateQueries({ queryKey: ["reviews"] });
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        actions={
          !isPending && !isError && groups.length > 0 ? (
            <ReviewFilters
              active={filter}
              onChange={(category) => {
                const keepsSelection =
                  activeGroup !== null &&
                  (category === "all" ||
                    activeGroup.questions.some((question) => question.category === category));

                writeParam(
                  category === "all" || keepsSelection
                    ? { filter: category }
                    : { filter: category, application: null },
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
        <ul
          aria-label={copy.review.listAria}
          className="mt-3 grid list-none grid-cols-1 gap-2 xl:grid-cols-2"
        >
          {filtered.map((group) => (
            <ReviewApplicationCard group={group} key={group.applicationId} onOpen={openGroup} />
          ))}
        </ul>
      ) : null}

      <ReviewApplicationDrawer
        count={filtered.length}
        group={activeGroup}
        index={Math.max(0, activeIndex)}
        onClose={closeDrawer}
        onNext={() => {
          stepDrawer(1);
        }}
        onPrev={() => {
          stepDrawer(-1);
        }}
        onSaved={handleSaved}
      />
    </div>
  );
}
