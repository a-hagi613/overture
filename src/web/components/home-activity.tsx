import type { HomeActivitySentRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { HomeSentActivityRow } from "./home-activity-sent-row.tsx";
import { Card } from "./ui/card.tsx";
import { PanelHeader } from "./ui/panel-header.tsx";
import { PanelList } from "./ui/panel-list.tsx";

export function HomeActivity(props: {
  now: number;
  sent: readonly HomeActivitySentRow[];
  zone: string;
}) {
  const { now, sent, zone } = props;

  return (
    <Card
      ariaLabelledBy="home-activity"
      className="mt-4 overflow-hidden"
      dataTestId="home-activity"
    >
      <PanelHeader
        action={<span className="text-xs text-muted-foreground">{copy.home.activity.latest}</span>}
        title={copy.home.activity.title}
        titleId="home-activity"
      />
      <PanelList>
        {sent.map((row) => (
          <HomeSentActivityRow key={row.id} now={now} row={row} zone={zone} />
        ))}
      </PanelList>
    </Card>
  );
}
