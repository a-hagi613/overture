import { copy } from "../../shared/copy.ts";
import type { Dossier } from "../../shared/dossier.ts";
import { kilobytes } from "../lib/board-format.ts";
import { BoardMark } from "./board-mark.tsx";

export function BoardFileAsSent({ file }: { file: NonNullable<Dossier["file"]> }) {
  return (
    <section aria-labelledby="dossier-file" className="mt-6 border-t border-border pt-5">
      <div className="flex gap-3">
        <BoardMark kind={file.sentUnchanged ? "check" : "cross"} />
        <div>
          <h3 className="serif text-[22px] leading-[1.15]" id="dossier-file">
            {copy.board.dossier.fileTitle}
          </h3>
          <p className="mt-2 text-[13px] text-muted-foreground">{copy.board.dossier.fileBody}</p>
        </div>
      </div>
      <div className="mt-3.5 rounded-md border border-border bg-card p-3">
        <p className="mono truncate text-[12.5px] text-foreground">{file.filename}</p>
        <p className="mono mt-1 text-[10.5px] text-muted-foreground">
          {`${kilobytes(file.bytes)} · ${copy.board.dossier.fileSha} ${file.sha256.slice(0, 16)}…`}
        </p>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {file.sentUnchanged ? copy.board.dossier.fileMatch : copy.board.dossier.fileMismatch}
        </p>
      </div>
    </section>
  );
}
