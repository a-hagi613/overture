import type { HomeRange, HomeResponse } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";

function timeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    hour: "2-digit",
    hourCycle: "h23",
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
      arrow: range.sentDelta < 0 ? "↓" : "↑",
      delta: copy.home.sentDelta(range.sentDelta, days),
      label: copy.home.kpi.sent,
      tone: "text-ok",
      value: range.applicationsSent,
    },
    {
      arrow: "·",
      delta: paused ? copy.home.heldWhilePaused : nextSend,
      label: copy.home.kpi.queued,
      tone: "text-muted-foreground",
      value: home.queued,
    },
    {
      arrow: "↑",
      delta: copy.home.interviewsBooked(range.interviewsBooked),
      label: copy.home.kpi.replies,
      tone: "text-ok",
      value: range.replies,
    },
    {
      arrow: "!",
      delta: copy.home.applicationsWait(home.reviews.applications),
      label: copy.home.kpi.needsYou,
      tone: "text-need",
      value: home.reviews.total,
    },
  ];

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4 min-[1100px]:gap-4">
      {cards.map((card) => (
        <article
          className="rounded-lg border border-border bg-card p-[14px_14px_12px] shadow-sh min-[768px]:p-[18px_20px_16px]"
          key={card.label}
        >
          <p className="text-[12.5px] font-medium leading-[1.5] text-muted-foreground">
            {card.label}
          </p>
          <p className="mt-2 font-serif text-[40px] leading-none tabular-nums min-[768px]:text-[56px]">
            {card.value}
          </p>
          <p
            className={`mt-2.5 flex items-center gap-[5px] text-[12.5px] leading-[1.5] tabular-nums ${card.tone}`}
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {card.arrow}
            </span>
            {card.delta}
          </p>
        </article>
      ))}
    </div>
  );
}
