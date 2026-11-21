import { Link } from "react-router";

import type { HomeInboxRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";

function dateKey(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: zone,
    year: "numeric",
  }).format(new Date(at));
}

function timeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(at));
}

function stampText(at: number, now: number, zone: string) {
  if (dateKey(at, zone) === dateKey(now, zone)) {
    return timeText(at, zone);
  }

  const weekday = new Intl.DateTimeFormat(copy.home.dateLocale, {
    timeZone: zone,
    weekday: "short",
  }).format(new Date(at));

  return `${weekday} ${timeText(at, zone)}`;
}

function toneFor(kind: string) {
  if (kind === "ack") {
    return { icon: "check", tone: "bg-signal-soft text-signal-text" } as const;
  }

  if (kind === "rejection") {
    return { icon: "dash", tone: "bg-muted text-muted-foreground" } as const;
  }

  return { icon: "mail", tone: "bg-ok-soft text-ok" } as const;
}

export function HomeInbox(props: { now: number; rows: readonly HomeInboxRow[]; zone: string }) {
  const { now, rows, zone } = props;

  return (
    <section
      aria-labelledby="home-inbox"
      className="mt-5 rounded-lg border border-border bg-card px-4 pb-2.5 pt-[22px] shadow-sh min-[768px]:px-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3.5">
          <h2 className="font-serif text-[26px] leading-[1.5]" id="home-inbox">
            {copy.home.inbox.title}
          </h2>
          <span className="font-serif text-sm italic text-muted-foreground">
            {copy.home.inbox.fig}
          </span>
        </div>
        <Link
          className="inline-flex min-h-[34px] items-center justify-center rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold hover:bg-muted"
          to="/inbox"
        >
          {copy.home.inbox.open}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2.5 text-sm text-muted-foreground">{copy.home.inbox.empty}</p>
      ) : (
        <div className="mt-2.5 grid grid-cols-1 gap-x-12 min-[900px]:grid-cols-2">
          {rows.map((row) => {
            const { icon, tone } = toneFor(row.kind);

            return (
              <div className="flex items-start gap-3.5 border-t border-border py-3.5" key={row.id}>
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 flex-none items-center justify-center rounded-full ${tone}`}
                >
                  <NavGlyph name={icon} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] leading-[1.4]">
                    <b className="font-semibold">{row.company}</b> {row.text}
                  </p>
                  {row.detail === null ? null : (
                    <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
                      {row.detail}
                    </p>
                  )}
                </div>
                <span className="flex-none pt-0.5 font-mono text-[11.5px] text-muted-foreground">
                  {stampText(row.at, now, zone)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
