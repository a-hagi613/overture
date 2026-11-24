import type { HomeActivityFailedRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { HomeActivityFailedCard } from "./home-activity-failed-card.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle } from "./ui/ds.ts";

export function HomeFailures(props: {
  failed: readonly HomeActivityFailedRow[];
  now: number;
  zone: string;
}) {
  const { failed, now, zone } = props;

  return (
    <Card ariaLabelledBy="home-failures" className="mt-5 p-5 md:p-6" dataTestId="home-failures">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={dsCardTitle} id="home-failures">
          {copy.home.activity.couldNotApply}
        </h2>
        <span className="text-xs text-muted-foreground">{copy.home.activity.latest}</span>
      </div>
      <div className="mt-3 space-y-3">
        {failed.map((row) => (
          <HomeActivityFailedCard key={row.id} now={now} row={row} zone={zone} />
        ))}
      </div>
    </Card>
  );
}
