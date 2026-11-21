import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { STAGE_KEYS } from "../lib/board-api.ts";
import type { ApplicationDetail, StageKey } from "../lib/board-api.ts";
import { stageLabel } from "../lib/board-format.ts";

export function BoardSheetActions(props: {
  detail: ApplicationDetail;
  onArchive: () => void;
  onMove: (stage: StageKey) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="mt-4 flex flex-col gap-[9px] md:mt-[18px] md:flex-row md:flex-wrap md:gap-2.5">
      <a
        className="btn max-md:flex max-md:!min-h-12 max-md:!text-[14px]"
        href={props.detail.posting.url}
        rel="noreferrer"
        target="_blank"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
          width="14"
        >
          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
        </svg>
        {copy.board.openPosting}
      </a>
      <div className="relative flex gap-[9px] md:gap-2.5">
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="btn2 max-md:!min-h-12 max-md:flex-1 max-md:!text-[14px]"
          onClick={() => {
            setMenuOpen((current) => !current);
          }}
          type="button"
        >
          {copy.board.moveStage}
          <svg
            aria-hidden="true"
            fill="none"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button
          className="btn2 max-md:!min-h-12 max-md:flex-1 max-md:!text-[14px]"
          onClick={props.onArchive}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="max-md:hidden"
            fill="none"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
            width="14"
          >
            <rect height="5" rx="1" width="18" x="3" y="4" />
            <path d="M5 9v10h14V9M10 13h4" />
          </svg>
          {copy.board.archive}
        </button>
        {menuOpen ? (
          <div
            className="absolute top-full left-0 z-10 mt-1 min-w-[190px] rounded-md border border-input bg-card p-1 shadow-lift"
            role="menu"
          >
            {STAGE_KEYS.map((stage) => (
              <button
                className="flex w-full items-center rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                disabled={stage === props.detail.application.stage}
                key={stage}
                onClick={() => {
                  setMenuOpen(false);
                  props.onMove(stage);
                }}
                role="menuitem"
                type="button"
              >
                {stageLabel(stage)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
