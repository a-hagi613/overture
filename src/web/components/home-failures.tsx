import { Link } from "react-router";

import type { HomeActivityFailedRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { HomeActivityFailedCard } from "./home-activity-failed-card.tsx";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { PanelHeader } from "./ui/panel-header.tsx";
import { PanelList } from "./ui/panel-list.tsx";

const MAX_VISIBLE_FAILURES = 2;

export function HomeFailures(props: {
  failed: readonly HomeActivityFailedRow[];
  now: number;
  zone: string;
}) {
  const { failed, now, zone } = props;
  const visible = failed.slice(0, MAX_VISIBLE_FAILURES);

  const actionLink =
    failed.length > MAX_VISIBLE_FAILURES ? (
      <Link
        className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
        to="/tracker"
      >
        {copy.home.control.viewBoard}
      </Link>
    ) : undefined;

  return (
    <Card
      ariaLabelledBy="home-failures"
      className="flex h-full flex-col overflow-hidden"
      dataTestId="home-failures"
    >
      <PanelHeader
        action={actionLink}
        badge={<Badge variant="need">{String(failed.length)}</Badge>}
        className="py-2.5"
        title={copy.home.activity.couldNotApply}
        titleId="home-failures"
      />
      <PanelList>
        {visible.map((row) => (
          <HomeActivityFailedCard key={row.id} now={now} row={row} zone={zone} />
        ))}
      </PanelList>
    </Card>
  );
}
