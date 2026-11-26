import { ArrowLeft, ArrowUpRight, MailOpen } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useMarkRead, useThread } from "../lib/inbox-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { InboxMessageBlock } from "./inbox-message-block.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

function classificationBadge(value: string | null) {
  if (value === "offer") {
    return { label: copy.inbox.classifications.offer, variant: "signal" as const };
  }

  if (value === "interview") {
    return { label: copy.inbox.classifications.interview, variant: "ok" as const };
  }

  if (value === "screening") {
    return { label: copy.inbox.classifications.screening, variant: "secondary" as const };
  }

  if (value === "ack") {
    return { label: copy.inbox.classifications.ack, variant: "outline" as const };
  }

  if (value === "rejection") {
    return { label: copy.inbox.classifications.rejection, variant: "outline" as const };
  }

  return null;
}

export function InboxThreadPane({
  now,
  onBack,
  threadId,
  zone,
}: {
  now: number;
  onBack: () => void;
  threadId: string | null;
  zone: string;
}) {
  const { data, isError, isPending, refetch } = useThread(threadId);
  const markRead = useMarkRead();
  const marked = useRef(new Set<string>());

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

  if (threadId === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <MailOpen aria-hidden="true" className="text-muted-foreground" size={28} />
        <h2 className={`${dsCardTitle} mt-3`}>{copy.inbox.selectThreadTitle}</h2>
        <p className={`${dsBody} mt-1 max-w-xs text-xs`}>{copy.inbox.selectThreadBody}</p>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-6 w-1/3 rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="mt-6 h-32 w-full rounded bg-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm font-semibold text-foreground" role="alert">
          {copy.inbox.loadFailed}
        </p>
        <Button
          onClick={() => {
            void refetch();
          }}
          size="sm"
          variant="outline"
        >
          {copy.inbox.retry}
        </Button>
      </div>
    );
  }

  const { messages, thread } = data;
  const tag = classificationBadge(thread.classification);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-5 py-4 md:px-6">
        <Button className="-ml-2 mb-2 lg:hidden" onClick={onBack} size="sm" variant="ghost">
          <ArrowLeft aria-hidden="true" size={15} />
          <span>{copy.nav.inbox}</span>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <CompanyAvatar company={thread.company} size="lg" tone="signal" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className={`${dsCardTitle} break-words`}>{thread.company}</h2>
                {tag === null ? null : <Badge variant={tag.variant}>{tag.label}</Badge>}
                <Badge variant="outline">{copy.inbox.messageCount(messages.length)}</Badge>
              </div>
              <p className="mt-1 break-words text-sm font-medium text-foreground">
                {thread.subject}
              </p>
              {thread.title === null ? null : (
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{thread.title}</p>
              )}
            </div>
          </div>

          {thread.applicationId === null ? null : (
            <Button asChild size="sm" variant="outline">
              <Link to={`/tracker?application=${thread.applicationId}`}>
                <span>{copy.inbox.viewOnTracker}</span>
                <ArrowUpRight aria-hidden="true" size={14} />
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="px-5 py-5 md:px-6 lg:absolute lg:inset-0 lg:overflow-y-auto"
          data-scroll-region
        >
          {messages.map((message, index) => (
            <InboxMessageBlock
              first={index === 0}
              key={message.id}
              message={message}
              now={now}
              zone={zone}
            />
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-muted/30 px-5 py-2.5 text-center md:px-6">
        <p className="text-xs text-muted-foreground">{copy.inbox.readOnly}</p>
      </div>
    </div>
  );
}
