import type { HomeActivityFailedRow, HomeActivitySentRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { HomeActivityFailedCard } from "./home-activity-failed-card.tsx";
import { HomeSentActivityRow } from "./home-activity-sent-row.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle } from "./ui/ds.ts";

export function HomeActivity(props: {
  failed: readonly HomeActivityFailedRow[];
  now: number;
  sent: readonly HomeActivitySentRow[];
  zone: string;
}) {
  const { failed, now, sent, zone } = props;

  return (
    <Card ariaLabelledBy="home-activity" className="mt-5 p-5 md:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={dsCardTitle} id="home-activity">
          {copy.home.activity.title}
        </h2>
        <span className="text-xs text-muted-foreground">{copy.home.activity.latest}</span>
      </div>
      <div className="mt-4 divide-y divide-border">
        {sent.map((row) => (
          <HomeSentActivityRow key={row.id} now={now} row={row} zone={zone} />
        ))}
        {failed.map((row) => (
          <HomeActivityFailedCard key={row.id} now={now} row={row} zone={zone} />
        ))}
      </div>
    </Card>
  );
}
