import { copy } from "../../../shared/copy.ts";
import type { AdminUserInsight } from "../../lib/admin-api.ts";
import { insightCardClass } from "./insight-card-class.ts";
import { SpendLine } from "./insight-spend-line.tsx";
import { formatUsdMicros } from "./llm-format.ts";

export function InsightSpendCard({ insight }: { insight: AdminUserInsight }) {
  const { spend } = insight;
  const empty = spend.llm.length === 0 && spend.browser.length === 0;

  return (
    <section aria-labelledby="admin-user-spend" className={insightCardClass}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-card-title leading-[1.1]" id="admin-user-spend">
          {copy.admin.insightSpendHeading}
        </h2>
        <span
          className="font-serif text-card-title tabular-nums"
          data-testid="admin-user-spend-total"
        >
          {formatUsdMicros(spend.totalMicros)}
        </span>
      </div>
      {empty ? (
        <p className="mt-3 text-xs text-muted-foreground">{copy.admin.insightSpendNone}</p>
      ) : (
        <div className="mt-3">
          <p className="text-eyebrow font-semibold uppercase text-muted-foreground">
            {copy.admin.insightSpendGroup(
              copy.admin.insightSpendLlm,
              formatUsdMicros(spend.llmMicros),
            )}
          </p>
          {spend.llm.map((row) => (
            <SpendLine
              key={row.purpose}
              label={row.purpose}
              micros={row.costMicros}
              note={copy.admin.insightSpendCalls(row.calls)}
            />
          ))}
          <p className="mt-4 text-eyebrow font-semibold uppercase text-muted-foreground">
            {copy.admin.insightSpendGroup(
              copy.admin.insightSpendBrowser,
              formatUsdMicros(spend.browserMicros),
            )}
          </p>
          {spend.browser.map((row) => (
            <SpendLine
              key={row.provider}
              label={row.provider}
              micros={row.costMicros}
              note={copy.admin.insightSpendSends(row.attempts, row.browserMs / 1000)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
