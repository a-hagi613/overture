import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useMarkRead, useThread, useThreads } from "../lib/inbox-api.ts";
import { browserZone, currentTime } from "../lib/inbox-time.ts";
import { InboxMessageBlock } from "../components/inbox-message-block.tsx";
import { InboxThreadItem } from "../components/inbox-thread-item.tsx";
import { PageHeader } from "../components/page-header.tsx";

function dateLine() {
  const now = new Date();
  const weekday = now.toLocaleDateString(copy.home.dateLocale, { weekday: "long" });
  const month = now.toLocaleDateString(copy.home.dateLocale, { month: "long" });

  return `${weekday}, ${String(now.getDate())} ${month}`;
}

export function InboxThreadPage() {
  const { id = null } = useParams();
  const { data } = useThread(id);
  const { data: list } = useThreads();
  const markRead = useMarkRead();
  const marked = useRef(new Set<string>());
  const now = currentTime();
  const zone = browserZone();
  const thread = data?.thread ?? null;

  useEffect(() => {
    if (data === undefined) {
      return;
    }

    for (const message of data.messages) {
      if (
        message.readAt === null &&
        message.direction === "in" &&
        !marked.current.has(message.id)
      ) {
        marked.current.add(message.id);
        markRead.mutate(message.id);
      }
    }
  }, [data, markRead]);

  return (
    <div>
      <PageHeader
        lead={dateLine()}
        showRunningSwitch={false}
        titleNode={
          <>
            {copy.inbox.titlePlain}
            <span className="italic">{copy.inbox.titleItalic}</span>
          </>
        }
      />
      <div className="mt-[22px] grid grid-cols-[320px_minmax(0,1fr)] items-start gap-5 max-md:grid-cols-1">
        <section
          aria-label={copy.nav.inbox}
          className="rounded-lg border border-border bg-card p-2 shadow-sh max-md:hidden"
        >
          {(list?.threads ?? []).map((row) => (
            <InboxThreadItem active={row.id === id} key={row.id} now={now} row={row} zone={zone} />
          ))}
        </section>
        <section className="rounded-lg border border-border bg-card px-6 py-5.5 shadow-sh max-md:px-4">
          <Link
            className="inline-flex min-h-11 items-center text-[13.5px] leading-[20.25px] font-semibold text-muted-foreground md:hidden"
            to="/inbox"
          >
            {copy.inbox.backToInbox}
          </Link>
          {thread === null ? null : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-serif text-[30px] leading-[1.05]">{thread.company}</h2>
                <p className="mt-1.5 text-sm leading-[1.5] text-muted-foreground">
                  {thread.subject}
                </p>
                {thread.applicationId === null || thread.title === null ? null : (
                  <Link
                    className="block font-serif text-[15px] italic text-signal-text underline underline-offset-[3px]"
                    to={`/board?application=${thread.applicationId}`}
                  >
                    {copy.inbox.boardLink(thread.title)}
                  </Link>
                )}
              </div>
              {thread.needsChecking ? (
                <span className="inline-flex h-[19px] items-center rounded-full bg-need-soft px-2.5 text-[11.5px] font-semibold text-need">
                  {copy.inbox.unverifiedLabel}
                </span>
              ) : null}
            </div>
          )}
          <div className="mt-[18px]">
            {(data?.messages ?? []).map((message, index) => (
              <InboxMessageBlock
                first={index === 0}
                key={message.id}
                message={message}
                now={now}
                zone={zone}
              />
            ))}
          </div>
          <p className="mt-5 text-center font-serif text-sm leading-[1.5] italic text-muted-foreground">
            {copy.inbox.readOnly}
          </p>
        </section>
      </div>
    </div>
  );
}
