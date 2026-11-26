import { Archive, Check, ChevronDown, CircleHelp, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { canMoveApplicationToStage, canWithdrawApplication } from "../../shared/board.ts";
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

  const { application, posting } = props.detail;
  const withdrawable = canWithdrawApplication(application.status);
  const needsAnswer = application.status === "needs_review";
  const canApprove = application.status === "ready" || application.status === "approved";
  const canRetry = application.status === "failed" && posting.applyUrl !== null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {needsAnswer ? (
        <Button asChild size="sm" variant="primary">
          <Link to={`/review?application=${encodeURIComponent(application.id)}`}>
            <CircleHelp aria-hidden="true" size={14} />
            <span>{copy.board.actions.answer}</span>
          </Link>
        </Button>
      ) : null}

      {canApprove ? (
        <Button asChild size="sm" variant="primary">
          <Link
            to={
              application.status === "approved"
                ? "/ready"
                : `/ready?application=${encodeURIComponent(application.id)}`
            }
          >
            <Check aria-hidden="true" size={14} />
            <span>
              {application.status === "approved"
                ? copy.board.actions.manageSend
                : copy.board.actions.approve}
            </span>
          </Link>
        </Button>
      ) : null}

      {canRetry && posting.applyUrl !== null ? (
        <Button asChild size="sm" variant="secondary">
          <a href={posting.applyUrl} rel="noopener noreferrer" target="_blank">
            <span>{copy.board.actions.retry}</span>
          </a>
        </Button>
      ) : null}

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
          <Card className="absolute left-0 top-full z-20 mt-1.5 min-w-48 p-1.5" variant="default">
            <div role="menu">
              {STAGE_KEYS.map((stage) => {
                const isCurrent = stage === application.stage;
                const allowed = canMoveApplicationToStage(application.status, stage);
                let itemStyle = "text-foreground hover:bg-muted";

                if (isCurrent) {
                  itemStyle = "bg-signal-soft text-signal-text";
                } else if (!allowed) {
                  itemStyle = "cursor-not-allowed text-muted-foreground opacity-50";
                }

                return (
                  <button
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm font-medium transition ${itemStyle}`}
                    disabled={isCurrent || !allowed}
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
        <span>{withdrawable ? copy.board.cancel : copy.board.archive}</span>
      </Button>
    </div>
  );
}
