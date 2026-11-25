import { copy } from "../../../shared/copy.ts";
import type { AdminUserInsight } from "../../lib/admin-api.ts";
import { insightCardClass } from "./insight-card-class.ts";

export function InsightQueueCard({ insight }: { insight: AdminUserInsight }) {
  const { queue } = insight;

  return (
    <section aria-labelledby="admin-user-queue" className={insightCardClass}>
      <h2 className="font-serif text-card-title leading-[1.1]" id="admin-user-queue">
        {copy.admin.insightQueueHeading}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="admin-user-queue-summary">
        {copy.admin.insightQueueSummary(queue.total, queue.scored)}
      </p>
      {queue.top.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{copy.admin.insightQueueEmpty}</p>
      ) : (
        <ol className="mt-3">
          {queue.top.map((match) => (
            <li
              className="flex items-baseline justify-between gap-3 border-t border-border py-2.5 first:border-t-0"
              key={match.postingId}
            >
              <span className="min-w-0">
                <span className="block break-words text-sm font-semibold">
                  {match.title ?? copy.admin.insightQueueUnknown}
                </span>
                <span className="block break-words text-xs text-muted-foreground">
                  {[
                    match.company,
                    match.location,
                    match.open ? null : copy.admin.insightQueueClosed,
                  ]
                    .filter((part) => part !== null && part !== "")
                    .join(" · ")}
                </span>
              </span>
              <span className="flex-none text-xs tabular-nums text-muted-foreground">
                {match.score === null
                  ? copy.admin.insightQueueUnscored
                  : copy.admin.insightQueueScore(match.score)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
