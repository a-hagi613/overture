import type { CalendarItem } from "../lib/calendar-api.ts";

import { copy } from "../../shared/copy.ts";
import { CHIP_KINDS } from "../lib/calendar-format.ts";
import { chipKindOf } from "../lib/calendar-grid.ts";
import { CalendarChip } from "./calendar-chip.tsx";
import { KindDot } from "./calendar-kind-dot.tsx";

const CELL_CHIPS = 3;

export function CalendarCellBody({ items }: { items: readonly CalendarItem[] }) {
  const kinds = CHIP_KINDS.filter((kind) => items.some((entry) => chipKindOf(entry) === kind));
  const shown = items.slice(0, CELL_CHIPS);

  return (
    <>
      <span aria-hidden="true" className="mt-auto flex items-center gap-1 md:hidden">
        {kinds.slice(0, 3).map((kind) => (
          <KindDot key={kind} kind={kind} />
        ))}
      </span>
      <span aria-hidden="true" className="hidden min-w-0 flex-col gap-1 md:flex">
        {shown.map((entry) => (
          <CalendarChip block key={entry.id} kind={chipKindOf(entry)} label={entry.company} />
        ))}
        {items.length > shown.length ? (
          <span className="pl-0.5 text-eyebrow font-semibold text-muted-foreground">
            {copy.calendar.more(items.length - shown.length)}
          </span>
        ) : null}
      </span>
    </>
  );
}
