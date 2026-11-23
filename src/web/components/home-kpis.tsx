import type { HomeRange, HomeResponse } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { Card } from "./ui/card.tsx";
import { dsMetric } from "./ui/ds.ts";

function timeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(at));
}

export function HomeKpis(props: {
  days: number;
  home: HomeResponse;
  paused: boolean;
  range: HomeRange;
}) {
  const { days, home, paused, range } = props;

  const nextSend =
    home.nextSendAt === null
      ? copy.home.nextSendValue
      : copy.home.nextSends(timeText(home.nextSendAt, home.timeZone));

  const cards = [
    {
      delta: copy.home.sentDelta(range.sentDelta, days),
      deltaTone: range.sentDelta < 0 ? "text-muted-foreground" : "text-ok",
      label: copy.home.kpi.sent,
      value: range.applicationsSent,
    },
    {
      delta: paused ? copy.home.heldWhilePaused : nextSend,
      deltaTone: "text-muted-foreground",
      label: copy.home.kpi.queued,
      value: home.queued,
    },
    {
      delta: copy.home.interviewsBooked(range.interviewsBooked),
      deltaTone: "text-ok",
      label: copy.home.kpi.replies,
      value: range.replies,
    },
    {
      delta: copy.home.applicationsWait(home.reviews.applications),
      deltaTone: home.reviews.total > 0 ? "text-need" : "text-muted-foreground",
      label: copy.home.kpi.needsYou,
      value: home.reviews.total,
    },
  ];

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card className="flex flex-col justify-between p-5" key={card.label} variant="interactive">
          <p className="text-xs font-semibold text-muted-foreground">{card.label}</p>
          <p className={`${dsMetric} mt-3`}>{card.value}</p>
          <p className={`mt-3 text-xs font-medium ${card.deltaTone}`}>{card.delta}</p>
        </Card>
      ))}
    </div>
  );
}
