import type { HomeActivityFailedRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { stampText } from "../lib/home-time.ts";
import { ApplyRecovery } from "./apply-recovery.tsx";
import { dsMono } from "./ui/ds.ts";

export function HomeActivityFailedCard(props: {
  now: number;
  row: HomeActivityFailedRow;
  zone: string;
}) {
  const { now, row, zone } = props;

  return (
    <div
      aria-label={copy.home.activity.couldNotApplyAria(row.company, row.title)}
      className="flex items-start justify-between gap-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {`${row.company}, ${row.title}`}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{row.reason}</p>
        <ApplyRecovery applyUrl={row.applyUrl} company={row.company} />
      </div>
      <span className={`${dsMono} shrink-0 pt-0.5`}>{stampText(row.at, now, zone)}</span>
    </div>
  );
}
