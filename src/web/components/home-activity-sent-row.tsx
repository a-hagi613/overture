import type { HomeActivitySentRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { stampText } from "../lib/home-time.ts";

export function HomeSentActivityRow(props: {
  now: number;
  row: HomeActivitySentRow;
  zone: string;
}) {
  const { now, row, zone } = props;

  return (
    <div className="flex items-start gap-3.5 border-t border-border py-3.5">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ok-soft text-ok"
      >
        <svg
          fill="none"
          height="15"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="15"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-[1.4]">
          <b className="font-semibold">{row.company}</b>
          {" · "}
          {row.title}
        </p>
        <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
          {row.status === "confirming" ? copy.home.activity.confirming : copy.home.activity.sent}
        </p>
      </div>
      <span className="flex-none pt-0.5 font-mono text-[11.5px] text-muted-foreground">
        {stampText(row.at, now, zone)}
      </span>
    </div>
  );
}
