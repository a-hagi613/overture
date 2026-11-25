import { copy } from "../../shared/copy.ts";
import type { InboxThreadRow } from "../lib/inbox-api.ts";
import { threadStamp } from "../lib/inbox-time.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsMono } from "./ui/ds.ts";

function rowBadge(row: InboxThreadRow) {
  if (row.classification === "offer") {
    return { label: copy.inbox.classifications.offer, variant: "signal" as const };
  }

  if (row.classification === "interview") {
    return { label: copy.inbox.classifications.interview, variant: "ok" as const };
  }

  if (row.classification === "screening") {
    return { label: copy.inbox.classifications.screening, variant: "secondary" as const };
  }

  if (row.classification === "ack") {
    return { label: copy.inbox.classifications.ack, variant: "outline" as const };
  }

  return null;
}

export function InboxThreadListRow({
  now,
  onSelect,
  row,
  selected,
  zone,
}: {
  now: number;
  onSelect: (id: string) => void;
  row: InboxThreadRow;
  selected: boolean;
  zone: string;
}) {
  const tag = rowBadge(row);

  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={`relative flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition ${
        selected ? "bg-card" : "hover:bg-card/60"
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground`}
      onClick={() => {
        onSelect(row.id);
      }}
      type="button"
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-signal"
        />
      ) : null}
      <CompanyAvatar company={row.company} tone={selected ? "signal" : "neutral"} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {row.unread ? (
              <span
                aria-label={copy.inbox.unreadAria}
                className="h-2 w-2 shrink-0 rounded-full bg-signal"
              />
            ) : null}
            <span
              className={`truncate text-sm ${
                row.unread ? "font-bold text-foreground" : "font-semibold text-foreground"
              }`}
            >
              {row.company}
            </span>
          </span>
          <span className={`${dsMono} shrink-0`}>{threadStamp(row.lastMessageAt, now, zone)}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs font-medium text-foreground">
          {row.subject}
        </span>
        <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
          {row.snippet}
        </span>
        {tag === null && !row.needsChecking ? null : (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {tag === null ? null : <Badge variant={tag.variant}>{tag.label}</Badge>}
            {row.needsChecking ? <Badge variant="need">{copy.inbox.unverifiedLabel}</Badge> : null}
          </span>
        )}
      </span>
    </button>
  );
}
