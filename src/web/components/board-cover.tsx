import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { BoardDidNotHappen } from "./board-did-not-happen.tsx";
import { BoardFactsTrace } from "./board-facts-trace.tsx";
import { BoardFileAsSent } from "./board-file-as-sent.tsx";

export function BoardCover({ detail }: { detail: ApplicationDetail }) {
  const { dossier, snapshot } = detail;

  if (dossier === null) {
    return (
      <p className="pt-[18px] text-[13px] text-muted-foreground md:pt-[22px]">
        {copy.board.cover.noSnapshot}
      </p>
    );
  }

  const citedIds = new Set((snapshot?.coverLetter ?? []).flatMap((line) => line.resume_line_ids));

  const cited = snapshot?.resumeLines.filter((line) => citedIds.has(line.id)) ?? [];

  return (
    <div aria-label={copy.board.tabs.cover} className="pt-[18px] md:pt-[22px]" role="tabpanel">
      {snapshot === null ||
      snapshot.coverLetter === null ||
      snapshot.coverLetter.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{copy.board.cover.noSnapshot}</p>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-background px-5 py-4">
            {snapshot.coverLetter.map((line) => (
              <p className="serif text-[17px] leading-[1.6] [&+&]:mt-3" key={line.sentence}>
                {line.sentence}
              </p>
            ))}
          </div>
          {cited.length === 0 ? null : (
            <div className="mt-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.board.cover.citedHeading}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {cited.map((line) => (
                  <li
                    className="mono border-l border-border pl-2 text-[11px] text-muted-foreground"
                    key={line.id}
                  >
                    {`${line.id} · ${line.text}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {snapshot?.resume == null ? null : (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {copy.board.cover.resume}
          </p>
          <p className="mono mt-1 truncate text-[12.5px]">{snapshot.resume.filename}</p>
          <p className="mono mt-1 text-[10.5px] text-muted-foreground">
            {`${copy.board.cover.hash} · ${snapshot.resume.sha256.slice(0, 16)}… · ${String(
              Math.round(snapshot.resume.bytes / 1024),
            )} KB`}
          </p>
        </div>
      )}
      {dossier.file === null ? null : <BoardFileAsSent file={dossier.file} />}
      <BoardFactsTrace trace={dossier.factsTrace} />
      <BoardDidNotHappen keys={dossier.didNotHappen} />
    </div>
  );
}
