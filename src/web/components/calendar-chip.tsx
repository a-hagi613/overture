import type { ChipKind } from "../lib/calendar-grid.ts";

import { copy } from "../../shared/copy.ts";
import { CHIP_STYLE } from "../lib/calendar-style.ts";
import { KindDot } from "./calendar-kind-dot.tsx";

export function CalendarChip({
  block = false,
  kind,
  label,
}: {
  block?: boolean;
  kind: ChipKind;
  label?: string;
}) {
  return (
    <span
      className={`${block ? "flex" : "inline-flex max-w-full"} min-h-[21px] min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm px-1.5 text-eyebrow font-semibold ${CHIP_STYLE[kind].chip}`}
      data-chip={kind}
    >
      <KindDot kind={kind} />
      <span className="min-w-0 overflow-hidden text-ellipsis">
        {label ?? copy.calendar.kinds[kind]}
      </span>
    </span>
  );
}
