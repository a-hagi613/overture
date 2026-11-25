import type { HomeActivitySentRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { stampText } from "../lib/home-time.ts";
import { Badge } from "./ui/badge.tsx";
import { dsMono } from "./ui/ds.ts";

export function HomeSentActivityRow(props: {
  now: number;
  row: HomeActivitySentRow;
  zone: string;
}) {
  const { now, row, zone } = props;

  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-foreground">
            <span className="font-medium">{row.company}</span>
            {` · ${row.title}`}
          </p>
          <Badge variant="ok">
            {row.status === "confirming" ? copy.home.activity.confirming : copy.home.activity.sent}
          </Badge>
        </div>
      </div>
      <span className={`${dsMono} shrink-0`}>{stampText(row.at, now, zone)}</span>
    </div>
  );
}
