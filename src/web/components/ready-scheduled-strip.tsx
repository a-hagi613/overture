import { copy } from "../../shared/copy.ts";
import type { ReadyCard } from "../lib/ready-api.ts";
import { dsMono } from "./ui/ds.ts";

function formatSendTime(at: number | null, zone: string) {
  if (at === null) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(copy.home.dateLocale, {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone: zone,
    }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat(copy.home.dateLocale, {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
    }).format(new Date(at));
  }
}

export function ReadyScheduledStrip({
  cards,
  zone,
}: {
  cards: readonly ReadyCard[];
  zone: string;
}) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={copy.ready.approvedSectionAria}
      className="mt-2 border-t border-border pt-2"
    >
      <div className="max-h-14 space-y-1 overflow-y-auto pr-0.5">
        {cards.map((card) => {
          const scheduledAt = formatSendTime(card.sendAt, zone);

          return (
            <div className="flex items-center justify-between gap-2 text-xs" key={card.id}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
                  <span className="live-dot-wave absolute inline-flex h-full w-full rounded-full bg-ok animate-live-ping" />
                  <span className="live-dot-core relative inline-flex h-2 w-2 rounded-full bg-ok" />
                </span>
                <span className="truncate font-medium text-foreground">{card.company}</span>
              </span>
              <span className={`${dsMono} shrink-0`}>
                {scheduledAt === null
                  ? copy.ready.approvedNoSlot
                  : copy.ready.sendingAround(scheduledAt)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
