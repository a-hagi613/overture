import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import type { AuditRow } from "../../lib/admin-api.ts";

function formatAuditTimestamp(timestamp: number) {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
}

export function AuditEntryRow({
  expanded,
  onToggle,
  row,
}: {
  expanded: boolean;
  onToggle: () => void;
  row: AuditRow;
}) {
  const detailId = `audit-detail-${row.id}`;
  const detailText = JSON.stringify(row.detail, null, 2);

  return (
    <li className="border-t border-border px-4 py-3.5 first:border-t-0 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="font-mono" tone="neutral">
              {row.action}
            </Badge>
            <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
              {formatAuditTimestamp(row.at)}
            </span>
          </div>
          {row.reason.length > 0 ? <p className="mt-1.5 text-[13.5px]">{row.reason}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-muted-foreground">
            <span>{copy.admin.auditActorLabel(row.actorId)}</span>
            {row.targetUserId === null ? null : (
              <Link
                className="underline underline-offset-2 hover:text-foreground"
                to={`/admin/users/${encodeURIComponent(row.targetUserId)}`}
              >
                {copy.admin.auditTargetLabel(row.targetUserId)}
              </Link>
            )}
          </p>
        </div>
        <Button
          ariaControls={detailId}
          ariaExpanded={expanded}
          ariaLabel={
            expanded
              ? copy.admin.auditDetailHideAria(row.action)
              : copy.admin.auditDetailShowAria(row.action)
          }
          onClick={onToggle}
          variant="secondary"
        >
          {expanded ? copy.admin.auditDetailHide : copy.admin.auditDetailShow}
        </Button>
      </div>
      {expanded ? (
        <pre
          className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-[12px] leading-relaxed text-foreground"
          data-scroll-region
          id={detailId}
        >
          {detailText}
        </pre>
      ) : null}
    </li>
  );
}
