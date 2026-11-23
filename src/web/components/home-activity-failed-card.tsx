import type { HomeActivityFailedRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { stampText } from "../lib/home-time.ts";
import { Badge } from "./ui/badge.tsx";
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
      className="my-3 flex items-start justify-between gap-4 rounded-lg border border-need bg-need-soft px-4 py-3.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="need">{copy.home.activity.couldNotApply}</Badge>
          <p className="text-sm font-semibold text-foreground">{`${row.company}, ${row.title}`}</p>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{row.reason}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {copy.home.activity.nothingCharged}
        </p>
      </div>
      <span className={`${dsMono} shrink-0 pt-0.5`}>{stampText(row.at, now, zone)}</span>
    </fieldset>
  );
}
