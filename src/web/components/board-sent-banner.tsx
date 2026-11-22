import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { providerName, stamp } from "../lib/board-format.ts";
import { BoardMark } from "./board-mark.tsx";

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
      className="mt-3.5 flex gap-3 rounded-md border border-border bg-card p-3 md:mt-[18px]"
    >
      <BoardMark kind="check" />
      <div>
        <p className="mono text-[12.5px] text-foreground">
          {copy.board.dossier.sentVia(
            providerName(sentVia.provider),
            stamp(sentVia.submittedAt, detail.timeZone),
          )}
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {`${copy.board.dossier.sentOnce} ${confirmed}`}
        </p>
      </div>
    </section>
  );
}
