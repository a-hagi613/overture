import { AlertTriangle, CheckCircle2, Download, Paperclip } from "lucide-react";

import type { InboxMessage } from "../lib/inbox-api.ts";

import { copy } from "../../shared/copy.ts";
import { attachmentHref } from "../lib/inbox-api.ts";
import { messageStamp } from "../lib/inbox-time.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow, dsMono } from "./ui/ds.ts";

function fileSize(bytes: number) {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${String(Math.round(bytes / 1024))} KB`;
  }

  return `${String(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}

function formatOf(mime: string) {
  const base = mime.split(";")[0] ?? mime;

  return base.split("/")[1]?.toUpperCase() ?? base;
}

function paragraphsOf(text: string) {
  return text.split(/\n{2,}/u).filter((part) => part.trim() !== "");
}

function senderName(from: string) {
  const open = from.indexOf("<");

  return open === -1 ? from.trim() : from.slice(0, open).trim().replaceAll(/^"|"$/gu, "");
}

function senderEmail(from: string) {
  const open = from.indexOf("<");
  const close = from.indexOf(">", open + 1);

  if (open === -1 || close === -1) {
    return null;
  }

  return from.slice(open + 1, close).trim();
}

export function InboxMessageBlock(props: {
  first: boolean;
  message: InboxMessage;
  now: number;
  zone: string;
}) {
  const { first, message, now, zone } = props;
  const email = senderEmail(message.from);

  return (
    <div className={first ? "" : "mt-6 border-t border-border pt-6"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {senderName(message.from)}
          </p>
          {email === null ? null : (
            <span className="truncate font-mono text-xs text-muted-foreground">{email}</span>
          )}
          {message.auth === "pass" ? (
            <span className="inline-flex items-center text-ok" title={copy.inbox.verifiedLabel}>
              <CheckCircle2 aria-hidden="true" size={14} />
              <span className="sr-only">{copy.inbox.verifiedLabel}</span>
            </span>
          ) : (
            <Badge variant="need">{copy.inbox.unverifiedLabel}</Badge>
          )}
        </div>
        <span className={dsMono}>{messageStamp(message.createdAt, now, zone)}</span>
      </div>

      {first ? null : (
        <p className="mt-1 text-xs font-medium text-muted-foreground">{message.subject}</p>
      )}

      {message.auth === "pass" ? null : (
        <Card className="mt-3.5 border-need bg-need-soft p-3.5 shadow-none">
          <div className="flex items-start gap-2.5" role="note">
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-need" size={16} />
            <div>
              <p className="text-xs font-semibold text-need">{copy.inbox.unverifiedTitle}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-foreground">
                {copy.inbox.unverifiedNote}
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-4 flex flex-col gap-3 text-sm leading-relaxed text-foreground">
        {paragraphsOf(message.text).map((paragraph, index) => (
          <p
            className="min-w-0 whitespace-pre-line break-words"
            key={`${message.id}-${String(index)}`}
          >
            {paragraph}
          </p>
        ))}
      </div>

      {message.attachments.length === 0 ? null : (
        <div className="mt-5 border-t border-border pt-4">
          <p className={dsEyebrow}>{copy.inbox.attachments(message.attachments.length)}</p>
          <div className="mt-2.5 flex flex-col gap-2">
            {message.attachments.map((attachment) => (
              <Card
                className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3"
                key={attachment.id}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Paperclip
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground"
                    size={15}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-medium text-foreground">
                      {attachment.filename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {`${formatOf(attachment.mime)} · ${fileSize(attachment.bytes)}`}
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <a href={attachmentHref(attachment.id)}>
                    <Download aria-hidden="true" size={14} />
                    <span>{copy.inbox.download}</span>
                  </a>
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
