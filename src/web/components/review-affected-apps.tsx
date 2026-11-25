import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { Review } from "../lib/review-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Button } from "./ui/button.tsx";
import { dsEyebrow } from "./ui/ds.ts";

const MAX_COMPACT_APPS = 6;

/**
 * Responsive grid of affected employer cards blocked on the active Review question, capped by
 * default with an inline overflow toggle.
 * @param props Blocked applications list.
 * @param props.applications Ordered employer applications blocked on this question.
 * @returns Grid of affected employer cards.
 */
export function ReviewAffectedApps({ applications }: { applications: Review["applications"] }) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = applications.length > MAX_COMPACT_APPS;
  const visible = expanded ? applications : applications.slice(0, MAX_COMPACT_APPS);
  const remaining = applications.length - MAX_COMPACT_APPS;

  return (
    <div>
      <p className={dsEyebrow}>{copy.review.blockedRolesTitle(applications.length)}</p>
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((application) => (
          <div
            className="flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-muted/25 px-3 py-2.5"
            key={application.applicationId}
          >
            <CompanyAvatar
              className="h-7 w-7 shrink-0 rounded text-xs"
              company={application.company}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">
                {application.company}
              </p>
              <p className="truncate text-xs text-muted-foreground">{application.title}</p>
            </div>
          </div>
        ))}
      </div>

      {hasOverflow ? (
        <Button
          className="mt-2"
          onClick={() => {
            setExpanded((current) => !current);
          }}
          size="xs"
          variant="ghost"
        >
          {expanded ? copy.review.showLessApps : copy.review.showMoreApps(remaining)}
        </Button>
      ) : null}
    </div>
  );
}
