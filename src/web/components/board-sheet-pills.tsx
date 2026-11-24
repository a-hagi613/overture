import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { money, providerName, stageLabel, stamp } from "../lib/board-format.ts";
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
  const salary = money(detail);
  const stage = stageLabel(detail.application.stage);
  const score = detail.match?.score ?? null;
  const isSent = detail.application.sentAt !== null || detail.dossier !== null;
  const strongMatch = score !== null && score >= 80;

  const sentTitle =
    detail.dossier === null
      ? undefined
      : copy.board.dossier.sentVia(
          detail.company,
          stamp(detail.dossier.sentVia.submittedAt, detail.timeZone),
        );

  const showStageBadge = stage !== null && !(isSent && detail.application.stage === "applied");

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {isSent ? (
        <Badge title={sentTitle} variant="ok">
          {copy.board.states.sent}
        </Badge>
      ) : null}
      {score === null ? null : (
        <Badge
          className="tabular-nums"
          title={detail.match?.reason ?? copy.board.matchFallbackReason}
          variant={strongMatch ? "signal" : "secondary"}
        >
          {copy.board.matchPercent(score)}
        </Badge>
      )}
      {detail.posting.location === null ? null : (
        <Badge variant="outline">{detail.posting.location}</Badge>
      )}
      {salary === null ? null : (
        <Badge className="tabular-nums" variant="secondary">
          {salary}
        </Badge>
      )}
      {detail.posting.ats === null ? null : (
        <Badge variant="outline">{providerName(detail.posting.ats)}</Badge>
      )}
      {showStageBadge ? (
        <Badge variant={stageBadgeVariant(detail.application.stage)}>{stage}</Badge>
      ) : null}
    </div>
  );
}
