import type { ChipKind } from "./calendar-grid.ts";

export const CHIP_STYLE = {
  checkin: { chip: "bg-need-soft text-need", dot: "bg-need" },
  closed: { chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  interview: { chip: "bg-signal-soft text-signal-text", dot: "bg-signal" },
  offer: { chip: "bg-ok-soft text-foreground", dot: "bg-ok" },
  sent: { chip: "bg-muted text-foreground", dot: "bg-foreground" },
  stage: { chip: "bg-muted text-foreground", dot: "bg-muted-foreground" },
} as const satisfies Record<ChipKind, { chip: string; dot: string }>;
