import { copy } from "../../shared/copy.ts";
import type { Dossier } from "../../shared/dossier.ts";
import { BoardTraceRow } from "./board-trace-row.tsx";

export function BoardFactsTrace({ trace }: { trace: Dossier["factsTrace"] }) {
  const empty = trace.answers.length === 0 && trace.letter.length === 0;

  return (
    <section aria-labelledby="dossier-trace" className="mt-6 border-t border-border pt-5">
      <h3 className="serif text-[22px] leading-[1.15]" id="dossier-trace">
        {copy.board.dossier.traceTitle}
      </h3>
      <p className="mt-2 text-[13px] text-muted-foreground">{copy.board.dossier.traceBody}</p>
      {empty ? (
        <p className="mt-3 text-[13px] text-muted-foreground">{copy.board.dossier.traceEmpty}</p>
      ) : null}
      {trace.letter.length === 0 ? null : (
        <div className="mt-4">
          <p className="mono text-[11px] text-muted-foreground">{copy.board.dossier.traceLetter}</p>
          <ul aria-label={copy.board.dossier.traceLetter} className="mt-2 list-none">
            {trace.letter.map((row, index) => (
              <BoardTraceRow key={`letter-${String(index)}`} row={row} />
            ))}
          </ul>
        </div>
      )}
      {trace.answers.length === 0 ? null : (
        <div className="mt-4">
          <p className="mono text-[11px] text-muted-foreground">
            {copy.board.dossier.traceAnswers}
          </p>
          <ul aria-label={copy.board.dossier.traceAnswers} className="mt-2 list-none">
            {trace.answers.map((row, index) => (
              <BoardTraceRow key={`answer-${String(index)}`} row={row} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
