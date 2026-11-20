import type { AuditRow } from "../../lib/admin-api.ts";

function lineOf(row: AuditRow) {
  const when = new Date(row.at).toISOString().replace("T", " ").slice(0, 16);

  return `${row.reason} · ${when}`;
}

export function AuditLine({ row }: { row: AuditRow }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <span className="font-mono text-[12.5px] font-semibold">{row.action}</span>
      <span className="text-[12.5px] text-muted-foreground">{lineOf(row)}</span>
    </div>
  );
}
