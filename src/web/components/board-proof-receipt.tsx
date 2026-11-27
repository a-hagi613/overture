import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { stamp } from "../lib/board-format.ts";
import { Card } from "./ui/card.tsx";
import { dsBody, dsMono } from "./ui/ds.ts";

export function BoardProofReceipt({ detail }: { detail: ApplicationDetail }) {
  const { dossier, receipt } = detail;

  if (dossier === null) {
    return (
      <p className="mt-1.5 text-sm text-muted-foreground">{copy.board.proof.receiptMissing}</p>
    );
  }

  const confirmed =
    dossier.sentVia.confirmedBy === "email"
      ? copy.board.proof.receiptEmail
      : copy.board.proof.receiptPage;

  return (
    <Card className="mt-2 p-3.5" variant="muted">
      <p className="break-words font-mono text-xs text-foreground">
        {copy.board.dossier.sentVia(
          detail.company,
          stamp(dossier.sentVia.submittedAt, detail.timeZone),
        )}
      </p>
      <p className={`${dsBody} mt-1`}>{confirmed}</p>
      {receipt === null ? null : (
        <p className={`${dsMono} mt-2 break-words`}>
          {`${copy.board.proof.receiptMessage(receipt.messageId)} · ${stamp(receipt.confirmedAt, detail.timeZone)}`}
        </p>
      )}
    </Card>
  );
}
