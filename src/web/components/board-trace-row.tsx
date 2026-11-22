import { copy } from "../../shared/copy.ts";
import type { TraceRow } from "../../shared/dossier.ts";
import { SourceChip } from "./source-chip.tsx";

export function BoardTraceRow({ row }: { row: TraceRow }) {
  const dashed = row.source === "typed" || row.source === "none";

  const factDetail =
    row.factKey === null || row.factRevision === null
      ? null
      : copy.board.dossier.traceFact(row.factKey, row.factRevision);

  return (
    <li className="border-b border-border py-3 first:pt-0 last:border-0">
      {row.label === null ? null : (
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {row.label}
        </p>
      )}
      <p className="serif mt-1 text-[19px] leading-[1.3]">{row.text}</p>
      <div className="mt-1.5">
        <SourceChip variant={dashed ? "dashed" : "solid"}>
          {copy.board.dossier.traceSource[row.source]}
        </SourceChip>
      </div>
      {factDetail === null ? null : (
        <p className="mono mt-1.5 text-[11px] text-muted-foreground">{factDetail}</p>
      )}
      {row.resumeLines.map((line) => (
        <p
          className="mono mt-1 border-l border-border pl-2 text-[11px] text-muted-foreground"
          key={line.id}
        >
          {`${line.id} · ${line.text}`}
        </p>
      ))}
    </li>
  );
}
