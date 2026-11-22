import type { ChipKind } from "../lib/calendar-grid.ts";

import { CHIP_STYLE } from "../lib/calendar-style.ts";

export function KindDot({ kind }: { kind: ChipKind }) {
  return (
    <i
      aria-hidden="true"
      className={`h-1.5 w-1.5 flex-none rounded-full ${CHIP_STYLE[kind].dot}`}
    />
  );
}
