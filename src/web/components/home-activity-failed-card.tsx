import type { HomeActivityFailedRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { stampText } from "../lib/home-time.ts";

export function HomeActivityFailedCard(props: {
  now: number;
  row: HomeActivityFailedRow;
  zone: string;
}) {
  const { now, row, zone } = props;

  return (
    <fieldset
      aria-label={copy.home.activity.couldNotApplyAria(row.company, row.title)}
      className="mt-3 mb-3.5 flex items-start gap-3.5 rounded-lg border border-need bg-need-soft px-4 py-3.5"
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-card text-need"
      >
        <svg
          fill="none"
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="14"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-[1.4]">
          <b className="font-bold">{copy.home.activity.couldNotApply}</b>
          {" · "}
          {row.company}
          {", "}
          {row.title}
        </p>
        <p className="mt-[3px] text-[13px] leading-[1.45]">{row.reason}</p>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
          {copy.home.activity.nothingCharged}
        </p>
      </div>
      <span className="flex-none pt-0.5 font-mono text-[11.5px] text-muted-foreground">
        {stampText(row.at, now, zone)}
      </span>
    </fieldset>
  );
}
