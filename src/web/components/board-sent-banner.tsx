import { CheckCircle2 } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { providerName, stamp } from "../lib/board-format.ts";
import { Card } from "./ui/card.tsx";

export function BoardSentBanner({ detail }: { detail: ApplicationDetail }) {
  const { dossier } = detail;

  if (dossier === null) {
    return null;
  }

  const { sentVia } = dossier;

  const confirmed =
    sentVia.confirmedBy === "email"
      ? copy.board.dossier.sentConfirmedEmail
      : copy.board.dossier.sentConfirmedPage;

  return (
    <Card
      ariaLabel={copy.board.dossier.sentLabel}
      className="mt-4 flex items-start gap-3 border-ok/25 bg-ok-soft/45 p-3.5 shadow-none"
    >
      <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-ok" size={18} />
      <div className="min-w-0">
        <p className="font-mono text-xs font-semibold text-foreground">
          {copy.board.dossier.sentVia(
            providerName(sentVia.provider),
            stamp(sentVia.submittedAt, detail.timeZone),
          )}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {`${copy.board.dossier.sentOnce} ${confirmed}`}
        </p>
      </div>
    </Card>
  );
}
