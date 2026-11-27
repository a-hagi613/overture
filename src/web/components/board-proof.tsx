import { Mail } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { BoardProofMail } from "./board-proof-mail.tsx";
import { BoardProofReceipt } from "./board-proof-receipt.tsx";
import { BoardProofScreenshots } from "./board-proof-screenshots.tsx";
import { dsCardTitle } from "./ui/ds.ts";

export function BoardProof({ detail }: { detail: ApplicationDetail }) {
  return (
    <div className="space-y-5 pt-5">
      <section aria-label={copy.board.proof.screenshotsTitle}>
        <h3 className={dsCardTitle}>{copy.board.proof.screenshotsTitle}</h3>
        <BoardProofScreenshots detail={detail} />
      </section>

      <section aria-label={copy.board.proof.receiptTitle}>
        <h3 className={dsCardTitle}>{copy.board.proof.receiptTitle}</h3>
        <BoardProofReceipt detail={detail} />
      </section>

      <section aria-label={copy.board.proof.emailsTitle}>
        <div className="flex items-center gap-2">
          <Mail aria-hidden="true" className="text-muted-foreground" size={16} />
          <h3 className={dsCardTitle}>{copy.board.proof.emailsTitle}</h3>
        </div>
        <BoardProofMail detail={detail} />
      </section>
    </div>
  );
}
