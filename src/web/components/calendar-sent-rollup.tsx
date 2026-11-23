import type { CalendarItem } from "../lib/calendar-api.ts";

import { copy } from "../../shared/copy.ts";

const NAMES_SHOWN = 3;

export function CalendarSentRollup({ items }: { items: readonly CalendarItem[] }) {
  const names = [...new Set(items.map((entry) => entry.company))];
  const shown = names.slice(0, NAMES_SHOWN);
  const rest = items.length - shown.length;

  return (
    <>
      <span className="block text-sm font-semibold">{copy.calendar.sentRollup(items.length)}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {rest > 0 ? copy.calendar.andMore(shown.join(", "), rest) : shown.join(", ")}
      </span>
    </>
  );
}
