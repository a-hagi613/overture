import { copy } from "../../shared/copy.ts";
import type { TraceRow } from "../../shared/dossier.ts";
import { SourceChip } from "./source-chip.tsx";
import { dsEyebrow, dsMono } from "./ui/ds.ts";

export function BoardTraceRow({ row }: { row: TraceRow }) {
  const dashed = row.source === "typed" || row.source === "none";

  const factDetail =
    row.factKey === null || row.factRevision === null
      ? null
      : copy.board.dossier.traceFact(row.factKey, row.factRevision);

  return (
    <li className="border-b border-border py-3 first:pt-0 last:border-0">
      {row.label === null ? null : <p className={dsEyebrow}>{row.label}</p>}
      <p className="mt-1 font-serif text-card-title leading-snug text-foreground">{row.text}</p>
      <div className="mt-2">
        <SourceChip variant={dashed ? "dashed" : "solid"}>
          {copy.board.dossier.traceSource[row.source]}
        </SourceChip>
      </div>
      {factDetail === null ? null : <p className={`${dsMono} mt-1.5`}>{factDetail}</p>}
      {row.resumeLines.map((line) => (
        <p className={`${dsMono} mt-1 border-l-2 border-signal/35 pl-2.5`} key={line.id}>
          {`${line.id} · ${line.text}`}
        </p>
      ))}
    </li>
  );
}
