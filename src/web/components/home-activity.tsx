import type { HomeActivityFailedRow, HomeActivitySentRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { HomeActivityFailedCard } from "./home-activity-failed-card.tsx";
import { HomeSentActivityRow } from "./home-activity-sent-row.tsx";

export function HomeActivity(props: {
  failed: readonly HomeActivityFailedRow[];
  now: number;
  sent: readonly HomeActivitySentRow[];
  zone: string;
}) {
  const { failed, now, sent, zone } = props;

  return (
    <section
      aria-labelledby="home-activity"
      className="mt-5 rounded-lg border border-border bg-card px-4 pt-[22px] pb-2.5 shadow-sh min-[768px]:px-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[26px] leading-[1.5]" id="home-activity">
          {copy.home.activity.title}
        </h2>
        <span className="text-[12.5px] leading-[1.5] text-muted-foreground">
          {copy.home.activity.latest}
        </span>
      </div>
      <div className="mt-2.5">
        {sent.map((row) => (
          <HomeSentActivityRow key={row.id} now={now} row={row} zone={zone} />
        ))}
        {failed.map((row) => (
          <HomeActivityFailedCard key={row.id} now={now} row={row} zone={zone} />
        ))}
      </div>
    </section>
  );
}
