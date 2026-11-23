import { copy } from "../../../shared/copy.ts";
import type { AttemptRow } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { AttemptOutcomeBadge } from "./attempt-outcome-badge.tsx";
import { AttemptSessionActions } from "./attempt-session-actions.tsx";
import { formatAttemptCost, formatAttemptDuration, formatProxyTraffic } from "./attempts-format.ts";

export function AttemptMobileItem({
  attempt,
  now,
  onFilterApplication,
  onInspectLive,
  onInspectReplay,
}: {
  attempt: AttemptRow;
  now: number;
  onFilterApplication: (applicationId: string) => void;
  onInspectLive: (attempt: AttemptRow) => void;
  onInspectReplay: (attempt: AttemptRow) => void;
}) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{attempt.postingTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{attempt.companyName}</p>
        </div>
        <AttemptOutcomeBadge attempt={attempt} />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs tabular-nums text-muted-foreground">
        <span>{attempt.ats ?? copy.admin.attemptsAtsUnknown}</span>
        <span>{copy.admin.reportBrowserName(attempt.provider)}</span>
        <span>{formatAttemptDuration(attempt.browserMs)}</span>
        <span>{formatProxyTraffic(attempt.proxyBytes)}</span>
        <span>{formatAttemptCost(attempt.costMicros)}</span>
        <span>{adminDayTime(attempt.startedAt, now)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          className="min-h-11 rounded-md px-2 font-mono text-eyebrow text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          onClick={() => {
            onFilterApplication(attempt.applicationId);
          }}
          type="button"
        >
          {copy.admin.attemptsApplicationPrefix(attempt.applicationId.slice(0, 12))}
        </button>
        <AttemptSessionActions
          attempt={attempt}
          onInspectLive={onInspectLive}
          onInspectReplay={onInspectReplay}
        />
      </div>
    </li>
  );
}
