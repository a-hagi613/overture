import { copy } from "../../../shared/copy.ts";
import type { AdminUserInsight } from "../../lib/admin-api.ts";
import { insightCardClass } from "./insight-card-class.ts";
import { AdminStatRow } from "./stat-row.tsx";

export function InsightCreditsCard({ insight }: { insight: AdminUserInsight }) {
  const statuses = Object.entries(insight.applications).toSorted(
    ([, left], [, right]) => right - left,
  );

  return (
    <section aria-labelledby="admin-user-credits" className={insightCardClass}>
      <h2 className="font-serif text-card-title leading-[1.1]" id="admin-user-credits">
        {copy.admin.insightCreditsHeading}
      </h2>
      <div className="mt-3">
        <AdminStatRow
          label={copy.admin.insightCreditsAvailable}
          value={insight.credits.available}
        />
        <AdminStatRow label={copy.admin.insightCreditsReserved} value={insight.credits.reserved} />
        <AdminStatRow label={copy.admin.insightCreditsUsed} value={insight.credits.used} />
      </div>
      {statuses.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{copy.admin.insightApplicationsNone}</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {statuses.map(([status, total]) => (
            <li
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-eyebrow font-semibold text-muted-foreground"
              key={status}
            >
              {copy.admin.insightApplicationStatus(status)}
              <span className="tabular-nums text-foreground">{total}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
