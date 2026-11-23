import { copy } from "../../../shared/copy.ts";
import type { AttemptRow } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { AttemptOutcomeBadge } from "./attempt-outcome-badge.tsx";
import { AttemptSessionActions } from "./attempt-session-actions.tsx";
import { formatAttemptCost, formatAttemptDuration, formatProxyTraffic } from "./attempts-format.ts";

export function AttemptTableRow({
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
    <tr className="border-t border-border align-top hover:bg-muted/60">
      <td className="px-4 py-3">
        <p className="font-semibold leading-snug">{attempt.postingTitle}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{attempt.companyName}</p>
        <button
          className="mt-1 rounded-sm font-mono text-eyebrow text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          onClick={() => {
            onFilterApplication(attempt.applicationId);
          }}
          type="button"
        >
          {copy.admin.attemptsApplicationPrefix(attempt.applicationId.slice(0, 12))}
        </button>
      </td>
      <td className="px-3 py-3 font-mono text-xs">
        {attempt.ats ?? copy.admin.attemptsAtsUnknown}
      </td>
      <td className="px-3 py-3 text-xs">{copy.admin.reportBrowserName(attempt.provider)}</td>
      <td className="px-3 py-3">
        <AttemptOutcomeBadge attempt={attempt} />
        {attempt.errorCode === null ? null : (
          <p className="mt-1 font-mono text-eyebrow text-muted-foreground">{attempt.errorCode}</p>
        )}
      </td>
      <td className="px-3 py-3 font-mono text-xs tabular-nums">
        {formatAttemptDuration(attempt.browserMs)}
      </td>
      <td className="px-3 py-3 font-mono text-xs tabular-nums">
        {formatProxyTraffic(attempt.proxyBytes)}
      </td>
      <td className="px-3 py-3 font-mono text-xs tabular-nums">
        {formatAttemptCost(attempt.costMicros)}
      </td>
      <td className="px-3 py-3 font-mono text-xs tabular-nums text-muted-foreground">
        {adminDayTime(attempt.startedAt, now)}
      </td>
      <td className="px-4 py-3">
        <AttemptSessionActions
          attempt={attempt}
          onInspectLive={onInspectLive}
          onInspectReplay={onInspectReplay}
        />
      </td>
    </tr>
  );
}
