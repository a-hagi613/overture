import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { Card } from "./ui/card.tsx";

export function BoardSheetMatch({ detail }: { detail: ApplicationDetail }) {
  const score = detail.match?.score ?? null;

  if (score === null) {
    return null;
  }

  const clamped = Math.min(100, Math.max(0, score));
  const strongFit = clamped >= 80;

  return (
    <Card className="mt-4 border-signal/25 bg-signal-soft/45 p-3.5 shadow-none">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {copy.board.matchCardTitle(clamped)}
        </p>
        <span className="text-xs font-semibold text-signal-text">
          {strongFit ? copy.board.matchStrongFit : copy.board.matchStandardFit}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/80">
        <div
          className="h-full rounded-full bg-signal transition-all"
          style={{ width: `${String(clamped)}%` }}
        />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {detail.match?.reason ?? copy.board.matchFallbackReason}
      </p>
    </Card>
  );
}
