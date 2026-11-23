import { ChevronRight } from "lucide-react";

import type { Review } from "../lib/review-api";

import { copy } from "../../shared/copy.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";

export function ReviewRow({
  review,
  selected,
  onSelect,
}: {
  review: Review;
  selected: boolean;
  onSelect: () => void;
}) {
  const primary = review.applications[0] ?? null;
  const extraCount = Math.max(0, review.applications.length - 1);

  return (
    <button
      aria-pressed={selected}
      className={`group flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3.5 text-left text-foreground transition ${
        selected ? "border-input bg-muted" : "border-transparent hover:bg-muted"
      }`}
      onClick={onSelect}
      type="button"
    >
      <CompanyAvatar company={primary?.company ?? copy.app.name} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold leading-snug text-foreground">
            {primary?.company ?? copy.review.blockedBadge}
          </span>
          {extraCount > 0 ? (
            <Badge className="tabular-nums" variant="signal">
              {copy.review.moreRoles(extraCount)}
            </Badge>
          ) : null}
        </span>
        {primary === null ? null : (
          <span className="mt-0.5 block truncate text-xs font-medium text-muted-foreground">
            {primary.title}
          </span>
        )}
        <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-signal-text">
          {copy.review.missingPrefix(review.prompt)}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className={`mt-1 h-4 w-4 shrink-0 transition ${
          selected
            ? "text-foreground"
            : "text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground"
        }`}
      />
    </button>
  );
}
