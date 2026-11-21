import { Link } from "react-router";

import type { InboxThreadRow } from "../lib/inbox-api.ts";

import { copy } from "../../shared/copy.ts";
import { pillOf } from "../lib/inbox-pill.ts";
import { threadStamp } from "../lib/inbox-time.ts";

export function InboxThreadRowView(props: { now: number; row: InboxThreadRow; zone: string }) {
  const { now, row, zone } = props;
  const pill = pillOf(row);

  return (
    <article className="flex items-start gap-3 border-t border-border px-[18px] py-4">
      {row.unread ? (
        <>
          <span aria-hidden="true" className="mt-2 h-2 w-2 flex-none rounded-full bg-signal" />
          <span className="sr-only">{copy.inbox.unreadAria}</span>
        </>
      ) : (
        <span className="w-2 flex-none" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <Link
            className="text-[14.5px] font-bold hover:underline underline-offset-[3px]"
            to={`/inbox/${row.id}`}
          >
            {row.company}
          </Link>
          {row.title === null || row.applicationId === null ? null : (
            <Link
              className="font-serif text-sm leading-[1.5] italic text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
              to={`/board?application=${row.applicationId}`}
            >
              {`${row.title} →`}
            </Link>
          )}
        </div>
        <p className="mt-1 text-[13.5px] font-bold">{row.subject}</p>
        <p className="mt-[3px] truncate text-[13px] text-muted-foreground">{row.snippet}</p>
        {pill === null ? null : (
          <div className="mt-2 flex h-[21px] items-start pt-0.5">
            <span
              className={`inline-flex h-[19px] items-center rounded-full px-2.5 text-[11.5px] font-semibold ${pill.tone}`}
            >
              {pill.label}
            </span>
          </div>
        )}
      </div>
      <p className="flex-none whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
        {threadStamp(row.lastMessageAt, now, zone)}
      </p>
    </article>
  );
}
