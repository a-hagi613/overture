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
    <fieldset
      aria-label={copy.home.activity.couldNotApplyAria(row.company, row.title)}
      className="flex items-start justify-between gap-4 rounded-lg border border-need bg-need-soft px-4 py-3.5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-foreground">
          {`${row.company}, ${row.title}`}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{row.reason}</p>
        <ApplyRecovery applyUrl={row.applyUrl} company={row.company} />
      </div>
      <span className={`${dsMono} shrink-0 pt-0.5`}>{stampText(row.at, now, zone)}</span>
    </fieldset>
  );
}
