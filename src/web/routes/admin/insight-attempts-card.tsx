import { copy } from "../../../shared/copy.ts";
import type { AdminUserInsight } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import {
  ATTEMPT_TONE_CLASSES,
  attemptOutcomeDisplay,
  formatAttemptCost,
  formatAttemptDuration,
} from "./attempts-format.ts";
import { insightCardClass } from "./insight-card-class.ts";

export function InsightAttemptsCard({ insight, now }: { insight: AdminUserInsight; now: number }) {
  return (
    <section aria-labelledby="admin-user-attempts" className={insightCardClass}>
      <h2 className="font-serif text-card-title leading-[1.1]" id="admin-user-attempts">
        {copy.admin.insightAttemptsHeading}
      </h2>
      {insight.attempts.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{copy.admin.insightAttemptsEmpty}</p>
      ) : (
        <ul className="mt-3">
          {insight.attempts.map((attempt) => {
            const display = attemptOutcomeDisplay(attempt.outcome);

            return (
              <li
                className="border-t border-border py-2.5 first:border-t-0"
                data-testid="admin-user-attempt"
                key={attempt.id}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-semibold">
                    {copy.admin.insightAttemptTitle(attempt.title, attempt.company)}
                  </span>
                  <span
                    className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${ATTEMPT_TONE_CLASSES[display.tone]}`}
                  >
                    {display.label}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {[
                    attempt.provider,
                    adminDayTime(attempt.startedAt, now),
                    formatAttemptDuration(attempt.browserMs),
                    formatAttemptCost(attempt.costMicros),
                    attempt.providerSessionId === null
                      ? null
                      : copy.admin.insightAttemptsSession(attempt.providerSessionId),
                    attempt.errorCode,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
