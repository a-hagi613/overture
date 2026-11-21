import { Link } from "react-router";

import type { InboxThreadRow } from "../lib/inbox-api.ts";

import { copy } from "../../shared/copy.ts";
import { threadStamp } from "../lib/inbox-time.ts";

function pillOf(row: InboxThreadRow) {
  if (row.needsChecking) {
    return {
      label: copy.inbox.unverifiedLabel,
      tone: "bg-need-soft text-need",
    };
  }

  if (row.classification === "code") {
    return { label: copy.inbox.codeUsed, tone: "bg-muted text-foreground" };
  }

  return null;
}

export function InboxThreadItem(props: {
  active: boolean;
  now: number;
  row: InboxThreadRow;
  zone: string;
}) {
  const { active, now, row, zone } = props;
  const pill = pillOf(row);

  return (
    <Link
      aria-current={active ? "true" : undefined}
      className={`block rounded-lg border px-3.5 py-3 ${
        active ? "border-input bg-card shadow-sh" : "border-transparent hover:bg-muted"
      }`}
      to={`/inbox/${row.id}`}
    >
      <p className="truncate text-[13.5px] font-semibold">{row.company}</p>
      <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{row.subject}</p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        {threadStamp(row.lastMessageAt, now, zone)}
      </p>
      {pill === null ? null : (
        <div className="mt-1.5 flex h-[21px] items-start pt-0.5">
          <span
            className={`inline-flex h-[19px] items-center rounded-full px-2.5 text-[11.5px] font-semibold ${pill.tone}`}
          >
            {pill.label}
          </span>
        </div>
      )}
    </Link>
  );
}
