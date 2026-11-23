import { Archive, Check, ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { STAGE_KEYS } from "../lib/board-api.ts";
import type { ApplicationDetail, StageKey } from "../lib/board-api.ts";
import { stageLabel } from "../lib/board-format.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";

export function BoardSheetActions(props: {
  detail: ApplicationDetail;
  onArchive: () => void;
  onMove: (stage: StageKey) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button asChild size="sm" variant="primary">
        <a href={props.detail.posting.url} rel="noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" size={14} />
          <span>{copy.board.openPosting}</span>
        </a>
      </Button>

      <div className="relative">
        <Button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => {
            setMenuOpen((current) => !current);
          }}
          size="sm"
          variant="secondary"
        >
          <span>{copy.board.moveStage}</span>
          <ChevronDown aria-hidden="true" size={14} />
        </Button>

        {menuOpen ? (
          <Card
            className="absolute left-0 top-full z-20 mt-1.5 min-w-[190px] p-1.5"
            variant="elevated"
          >
            <div role="menu">
              {STAGE_KEYS.map((stage) => {
                const isCurrent = stage === props.detail.application.stage;

                return (
                  <button
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm font-medium transition ${
                      isCurrent
                        ? "bg-signal-soft text-signal-text"
                        : "text-foreground hover:bg-muted"
                    }`}
                    disabled={isCurrent}
                    key={stage}
                    onClick={() => {
                      setMenuOpen(false);
                      props.onMove(stage);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>{stageLabel(stage)}</span>
                    {isCurrent ? <Check aria-hidden="true" size={14} /> : null}
                  </button>
                );
              })}
            </div>
          </Card>
        ) : null}
      </div>

      <Button onClick={props.onArchive} size="sm" variant="outline">
        <Archive aria-hidden="true" size={14} />
        <span>{copy.board.archive}</span>
      </Button>
    </div>
  );
}
