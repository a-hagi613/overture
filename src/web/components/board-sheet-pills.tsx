import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { stageLabel, stamp } from "../lib/board-format.ts";
import { Badge } from "./ui/badge.tsx";

function stageBadgeVariant(stage: string | null) {
  if (stage === "offer") {
    return "signal" as const;
  }

  if (stage === "ready" || stage === "interviewing") {
    return "ok" as const;
  }

  if (stage === "closed") {
    return "outline" as const;
  }

  return "secondary" as const;
}

export function BoardSheetPills({ detail }: { detail: ApplicationDetail }) {
  const stage = stageLabel(detail.application.stage);
  const isSent = detail.application.sentAt !== null || detail.dossier !== null;

  const sentTitle =
    detail.dossier === null
      ? undefined
      : copy.board.dossier.sentVia(
          detail.company,
          stamp(detail.dossier.sentVia.submittedAt, detail.timeZone),
        );

  const showStageBadge = stage !== null && !(isSent && detail.application.stage === "applied");

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {isSent ? (
        <Badge title={sentTitle} variant="ok">
          {copy.board.states.sent}
        </Badge>
      ) : null}
      {showStageBadge ? (
        <Badge variant={stageBadgeVariant(detail.application.stage)}>{stage}</Badge>
      ) : null}
    </div>
  );
}
