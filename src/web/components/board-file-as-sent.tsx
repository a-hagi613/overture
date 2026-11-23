import { CheckCircle2, FileText, XCircle } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { Dossier } from "../../shared/dossier.ts";
import { kilobytes } from "../lib/board-format.ts";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsMono } from "./ui/ds.ts";

export function BoardFileAsSent({ file }: { file: NonNullable<Dossier["file"]> }) {
  return (
    <section aria-labelledby="dossier-file">
      <div className="flex items-start gap-2.5">
        {file.sentUnchanged ? (
          <CheckCircle2 aria-hidden="true" className="mt-1 shrink-0 text-ok" size={18} />
        ) : (
          <XCircle aria-hidden="true" className="mt-1 shrink-0 text-need" size={18} />
        )}
        <div>
          <h3 className={dsCardTitle} id="dossier-file">
            {file.sentUnchanged
              ? copy.board.dossier.fileTitle
              : copy.board.dossier.fileTitleMismatch}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{copy.board.dossier.fileBody}</p>
        </div>
      </div>

      <Card className="mt-3 p-3.5" variant="muted">
        <div className="flex items-center gap-2">
          <FileText aria-hidden="true" className="shrink-0 text-signal-text" size={16} />
          <p className="truncate font-mono text-xs font-semibold text-foreground">
            {file.filename}
          </p>
        </div>
        <p className={`${dsMono} mt-1.5`}>
          {`${kilobytes(file.bytes)} · ${copy.board.dossier.fileSha} ${file.sha256.slice(0, 16)}…`}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {file.sentUnchanged ? copy.board.dossier.fileMatch : copy.board.dossier.fileMismatch}
        </p>
      </Card>
    </section>
  );
}
