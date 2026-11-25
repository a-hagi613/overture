import { copy } from "../../../shared/copy.ts";
import type { AdminUserInsight } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { insightCardClass } from "./insight-card-class.ts";

export function InsightTimelineCard({ insight, now }: { insight: AdminUserInsight; now: number }) {
  return (
    <section aria-labelledby="admin-user-timeline" className={insightCardClass}>
      <h2 className="font-serif text-card-title leading-[1.1]" id="admin-user-timeline">
        {copy.admin.insightTimelineHeading}
      </h2>
      {insight.timeline.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{copy.admin.insightTimelineEmpty}</p>
      ) : (
        <ol className="mt-3" data-testid="admin-user-timeline">
          {insight.timeline.map((activity, index) => (
            <li
              className="grid grid-cols-1 gap-0.5 border-t border-border py-2.5 first:border-t-0 md:grid-cols-[150px_120px_1fr] md:gap-4"
              key={`${String(activity.at)}-${activity.kind}-${String(index)}`}
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                {adminDayTime(activity.at, now)}
              </span>
              <span className="text-xs font-semibold">
                {copy.admin.insightActivityKind(activity.kind)}
              </span>
              <span className="min-w-0 break-words text-sm">{activity.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
