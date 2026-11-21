import type { InboxMessage } from "../lib/inbox-api.ts";

import { copy } from "../../shared/copy.ts";
import { attachmentHref } from "../lib/inbox-api.ts";
import { messageStamp } from "../lib/inbox-time.ts";

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

export function InboxMessageBlock(props: {
  first: boolean;
  message: InboxMessage;
  now: number;
  zone: string;
}) {
  const { first, message, now, zone } = props;

  return (
    <div className={first ? "" : "mt-6 border-t border-border pt-6"}>
      {first ? null : (
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{message.subject}</p>
        </div>
      )}
      {message.auth === "pass" ? null : (
        <div
          className="mt-[18px] rounded-lg border border-need bg-need-soft px-4 py-3.5"
          role="note"
        >
          <p className="text-[14px] leading-[21px] font-bold text-need">
            {copy.inbox.unverifiedTitle}
          </p>
          <p className="mt-1 text-[13.5px] text-foreground">{copy.inbox.unverifiedNote}</p>
        </div>
      )}
      <p className="mt-4 break-words font-mono text-xs leading-[1.5] text-muted-foreground">
        {copy.inbox.fromLine(
          senderName(message.from),
          messageStamp(message.createdAt, now, zone),
          message.auth === "pass",
        )}
      </p>
      <div className="mt-3.5 flex flex-col gap-3 text-[14.5px] leading-[1.6]">
        {paragraphsOf(message.text).map((paragraph, index) => (
          <p className="whitespace-pre-line" key={`${message.id}-${String(index)}`}>
            {paragraph}
          </p>
        ))}
      </div>
      {message.attachments.length === 0 ? null : (
        <div className="mt-[22px] border-t border-border pt-4">
          <p className="text-[11px] leading-[13px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            {copy.inbox.attachments(message.attachments.length)}
          </p>
          <div className="mt-2.5 flex flex-col gap-3">
            {message.attachments.map((attachment) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input bg-background px-3.5 py-3"
                key={attachment.id}
              >
                <div className="min-w-0">
                  <p className="break-words font-mono text-[13.5px]">{attachment.filename}</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {`${formatOf(attachment.mime)} · ${fileSize(attachment.bytes)}`}
                  </p>
                </div>
                <a
                  className="inline-flex min-h-9 items-center justify-center rounded-md border border-input bg-card px-3.5 text-[13px] font-semibold hover:bg-muted"
                  href={attachmentHref(attachment.id)}
                >
                  {copy.inbox.download}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
