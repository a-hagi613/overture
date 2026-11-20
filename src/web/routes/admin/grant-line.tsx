import type { GrantRow } from "../../lib/admin-api.ts";
import { copy } from "../../../shared/copy.ts";

function whenOf(at: number) {
  return new Date(at).toISOString().replace("T", " ").slice(0, 16);
}

export function GrantLine({ row }: { row: GrantRow }) {
  const when = whenOf(row.createdAt);
  const expires = row.expiresAt === null ? null : whenOf(row.expiresAt);

  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <span className="font-serif text-lg tabular-nums">{copy.home.usageCount(row.quantity)}</span>
      <span className="text-[12.5px] text-muted-foreground">
        {expires === null
          ? copy.admin.grantLine(row.email, when)
          : copy.admin.grantLineWithExpiry(row.email, when, expires)}
      </span>
    </div>
  );
}
