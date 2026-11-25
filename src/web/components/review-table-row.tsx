import { X } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { Review } from "../lib/review-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";

function summarizeCompanies(review: Review) {
  const [first] = review.applications;

  if (first === undefined) {
    return copy.review.categories[review.category];
  }

  if (review.applications.length === 1) {
    return `${first.company} · ${first.title}`;
  }

  const unique: string[] = [];

  for (const application of review.applications) {
    if (!unique.includes(application.company)) {
      unique.push(application.company);
    }
  }

  if (unique.length === 1) {
    return `${first.company} · ${copy.review.rolesCount(review.applications.length)}`;
  }

  const [, second] = unique;

  if (unique.length === 2 && second !== undefined) {
    return `${first.company} · ${second}`;
  }

  return `${first.company}, ${second ?? ""} ${copy.review.moreRoles(unique.length - 2)}`;
}

/**
 * Single row inside the Review action table showing the missing prompt, waiting companies,
 * topic category, unblock count badge, and quick Answer / Dismiss controls.
 * @param props Row selection state, Review payload, and action handlers.
 * @param props.active Whether this question is currently open in the slide-over answer drawer.
 * @param props.busy Whether a dismiss request is currently running for this row.
 * @param props.onDismiss Invoked when Dismiss is clicked inline.
 * @param props.onOpen Invoked when clicking the prompt button or Answer CTA.
 * @param props.review Review question payload.
 * @returns Review action table row element.
 */
export function ReviewTableRow({
  active,
  busy,
  onDismiss,
  onOpen,
  review,
}: {
  active: boolean;
  busy: boolean;
  onDismiss: (review: Review) => void;
  onOpen: (review: Review) => void;
  review: Review;
}) {
  const leadCompany = review.applications[0]?.company ?? copy.review.categories[review.category];
  const companySummary = summarizeCompanies(review);

  return (
    <article
      className={`flex flex-col gap-2.5 px-4 py-3.5 transition sm:px-5 lg:flex-row lg:items-center lg:gap-4 ${
        active ? "bg-muted/50" : "hover:bg-muted/30"
      }`}
    >
      <div className="min-w-0 lg:flex-1">
        <button
          className="flex min-w-0 w-full cursor-pointer items-center gap-3 rounded-md text-left max-md:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          onClick={() => {
            onOpen(review);
          }}
          type="button"
        >
          <CompanyAvatar company={leadCompany} size="sm" />
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 break-words text-sm font-semibold text-foreground">
              {review.prompt}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{companySummary}</p>
          </div>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:contents">
        <div className="lg:w-36 lg:shrink-0 xl:w-40">
          <Badge variant="outline">{copy.review.categories[review.category]}</Badge>
        </div>

        <div className="lg:w-36 lg:shrink-0 xl:w-40">
          <Badge className="tabular-nums" variant="signal">
            {copy.review.unlocksShort(review.unlocked)}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 lg:w-48 lg:shrink-0 lg:flex-nowrap lg:justify-end">
        <Button
          disabled={busy}
          onClick={() => {
            onOpen(review);
          }}
          size="xs"
          variant="primary"
        >
          <span>{copy.review.table.answer}</span>
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            onDismiss(review);
          }}
          size="xs"
          variant="ghost"
        >
          <X aria-hidden="true" size={13} />
          <span>{copy.review.dismiss}</span>
        </Button>
      </div>
    </article>
  );
}
