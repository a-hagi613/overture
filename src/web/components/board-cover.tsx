import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";

export function BoardCover({ detail }: { detail: ApplicationDetail }) {
  const { snapshot } = detail;

  if (snapshot === null) {
    return (
      <p className="pt-[18px] text-[13px] text-muted-foreground md:pt-[22px]">
        {copy.board.cover.noSnapshot}
      </p>
    );
  }

  return (
    <div aria-label={copy.board.tabs.cover} className="pt-[18px] md:pt-[22px]" role="tabpanel">
      {snapshot.coverLetter === null || snapshot.coverLetter.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{copy.board.cover.empty}</p>
      ) : (
        <div>
          {snapshot.coverLetter.map((line) => (
            <div className="mb-3" key={line.sentence}>
              <p className="serif text-[19px] leading-[1.4]">{line.sentence}</p>
              <p className="mono mt-1 text-[11px] text-muted-foreground">
                {copy.board.cover.lines(line.resume_line_ids.length)}
              </p>
            </div>
          ))}
        </div>
      )}
      {snapshot.resume === null ? null : (
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
    </div>
  );
}
