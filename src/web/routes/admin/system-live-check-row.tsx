import { copy } from "../../../shared/copy.ts";
import type { LiveCheckResult } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { SystemPill } from "./system-pill.tsx";

function detailText(detail: LiveCheckResult["detail"]) {
  const { error, skipped } = detail;

  if (error !== undefined) {
    return `${copy.admin.systemError}: ${error}`;
  }

  return skipped ?? "";
}

export function SystemLiveCheckRow({ now, result }: { now: number; result: LiveCheckResult }) {
  return (
    <li className="border-t border-border px-5 py-3.5 md:grid md:grid-cols-[minmax(0,1.4fr)_90px_100px_140px_minmax(0,1.3fr)] md:items-start md:gap-4">
      <span className="block min-w-0 break-all font-mono text-xs">{result.check}</span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:mt-0 md:block">
        <SystemPill
          label={result.ok ? copy.admin.systemPass : copy.admin.systemFail}
          tone={result.ok ? "ok" : "warn"}
        />
        <span className="text-xs tabular-nums text-muted-foreground md:hidden">
          {`${copy.admin.systemLatency(result.durationMs)} · ${adminDayTime(result.startedAt, now)}`}
        </span>
      </span>
      <span className="hidden text-xs tabular-nums md:block">
        {copy.admin.systemLatency(result.durationMs)}
      </span>
      <span className="hidden text-xs tabular-nums md:block">
        {adminDayTime(result.startedAt, now)}
      </span>
      <span className="mt-1.5 block min-w-0 break-words text-xs text-muted-foreground md:mt-0">
        {detailText(result.detail)}
      </span>
    </li>
  );
}
