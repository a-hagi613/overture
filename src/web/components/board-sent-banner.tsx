import { CheckCircle2 } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { stamp } from "../lib/board-format.ts";

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
    <section
      aria-label={copy.board.dossier.sentLabel}
      className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5"
    >
      <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-ok" size={18} />
      <div className="min-w-0">
        <p className="font-mono text-xs text-foreground">
          {copy.board.dossier.sentVia(detail.company, stamp(sentVia.submittedAt, detail.timeZone))}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {`${copy.board.dossier.sentOnce} ${confirmed}`}
        </p>
      </div>
    </section>
  );
}
