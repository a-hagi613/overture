import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { money, stageLabel } from "../lib/board-format.ts";

export function BoardSheetPills({ detail }: { detail: ApplicationDetail }) {
  const salary = money(detail);

  return (
    <div className="mt-[13px] flex flex-wrap gap-[7px] md:mt-[15px] md:gap-2">
      {detail.posting.location === null ? null : (
        <span className="pill">
          <svg
            aria-hidden="true"
            className="hidden md:inline"
            fill="none"
            height="13"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="13"
          >
            <path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          {detail.posting.location}
        </span>
      )}
      {salary === null ? null : <span className="pill num">{salary}</span>}
      {detail.match?.score === null || detail.match?.score === undefined ? null : (
        <span className="pill num border-transparent bg-muted text-foreground">
          {copy.board.match(detail.match.score)}
        </span>
      )}
      {detail.application.stage === null ? null : (
        <span className="pill border-transparent bg-ok-soft text-ok">
          {stageLabel(detail.application.stage)}
        </span>
      )}
    </div>
  );
}
