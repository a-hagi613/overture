import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { BoardDidNotHappen } from "./board-did-not-happen.tsx";
import { BoardFactsTrace } from "./board-facts-trace.tsx";
import { BoardFileAsSent } from "./board-file-as-sent.tsx";

export function BoardCover({ detail }: { detail: ApplicationDetail }) {
  const { dossier } = detail;

  if (dossier === null) {
    return <p className="pt-5 text-sm text-muted-foreground">{copy.board.cover.noSnapshot}</p>;
  }

  return (
    <div aria-label={copy.board.tabs.cover} className="space-y-5 pt-5" role="tabpanel">
      {dossier.file === null ? null : <BoardFileAsSent file={dossier.file} />}
      <BoardFactsTrace trace={dossier.factsTrace} />
      <BoardDidNotHappen keys={dossier.didNotHappen} />
    </div>
  );
}
