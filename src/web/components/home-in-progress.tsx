import type { HomeInProgressRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { sendTimeText } from "../lib/home-time.ts";
import { Badge } from "./ui/badge.tsx";
import { HomeSection } from "./home-section.tsx";
import { HomeSectionRow } from "./home-section-row.tsx";

function statusText(row: HomeInProgressRow, zone: string) {
  const text = copy.home.sections.inProgress;

  switch (row.status) {
    case "approved": {
      return row.sendsAt === null
        ? text.queuedNext
        : text.queuedAt(sendTimeText(row.sendsAt, zone));
    }

    case "preparing": {
      return text.preparing;
    }

    case "sending": {
      return text.sending;
    }

    default: {
      return text.confirming;
    }
  }
}

function statusVariant(row: HomeInProgressRow) {
  if (row.status === "sending" || row.status === "confirming") {
    return "signal" as const;
  }

  return row.status === "approved" ? ("outline" as const) : ("secondary" as const);
}

export function HomeInProgress(props: {
  items: readonly HomeInProgressRow[];
  total: number;
  zone: string;
}) {
  const { items, total, zone } = props;
  const text = copy.home.sections.inProgress;

  return (
    <HomeSection
      count={total}
      countLabel={text.count(total)}
      dataTestId="home-in-progress"
      href="/tracker"
      subtitle={text.subtitle}
      title={text.title}
      titleId="home-in-progress"
      viewAll={text.viewAll}
    >
      {items.map((row) => (
        <HomeSectionRow
          key={row.id}
          meta={row.company}
          title={row.title}
          to={`/tracker?application=${encodeURIComponent(row.id)}`}
          trailing={
            <Badge className="shrink-0" variant={statusVariant(row)}>
              {statusText(row, zone)}
            </Badge>
          }
        />
      ))}
    </HomeSection>
  );
}
