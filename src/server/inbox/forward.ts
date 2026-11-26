import type { AddressObject, Attachment, HeaderValue, ParsedMail } from "mailparser";

import { z } from "zod";

import { renderEmail } from "../platform/mail/template.ts";
import type { EmailTemplateInput } from "../platform/mail/template.ts";

import type { OutboundCopyAttachment, OutboundInboundCopyMail } from "../platform/mail/port.ts";

/** Kept well under the provider's 25 MiB message limit so one copy always fits. */
export const INBOUND_COPY_MAX_BYTES = 4 * 1024 * 1024;
export const INBOUND_COPY_MAX_ATTACHMENTS = 32;
export const INBOUND_COPY_PREVIEW_BYTES = 200 * 1024;
export const INBOUND_COPY_SUBJECT_MAX = 998;

export const INBOUND_COPY_HEADER_ALLOW_LIST = [
  "in-reply-to",
  "references",
  "thread-index",
  "thread-topic",
] as const;

const MAX_CUSTOM_HEADERS = 20;
const MAX_HEADER_VALUE_BYTES = 2048;
const MAX_HEADER_BYTES = 16_384;
const ALLOWED = new Set<string>(INBOUND_COPY_HEADER_ALLOW_LIST);
const CUSTOM_HEADER = /^x-[a-z0-9_-]{1,100}$/u;
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/u;
const SAFE_MIME_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u;
const encoder = new TextEncoder();

/**
 * Why a copy must not be sent: a delivery loop, or an account with no verified destination.
 * Stored Messages keep their Inbox copy either way.
 */
export type CopySkipReason = "auto_submitted" | "self_domain" | "x_loop";

function byteLength(value: string) {
  return encoder.encode(value).byteLength;
}

function truncateBytes(value: string, maximum: number) {
  if (byteLength(value) <= maximum) {
    return value;
  }

  let low = 0;
  let high = value.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (byteLength(value.slice(0, middle)) <= maximum) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return value.slice(0, low);
}

const repeatedHeader = z.union([z.string(), z.array(z.string())]);

function headerText(value: HeaderValue | undefined) {
  const parsed = repeatedHeader.safeParse(value);

  if (!parsed.success) {
    return "";
  }

  return Array.isArray(parsed.data) ? parsed.data.join(" ") : parsed.data;
}

function addressOf(value: ParsedMail["from"] | undefined) {
  return (value?.value[0]?.address ?? "").trim().toLowerCase();
}

function domainOf(address: string) {
  const at = address.lastIndexOf("@");

  return at === -1
    ? ""
    : address
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

function senderOf(parsed: ParsedMail) {
  const name = (parsed.from?.value[0]?.name ?? "").trim();
  const address = addressOf(parsed.from);

  if (name !== "" && address !== "") {
    return `${name} <${address}>`;
  }

  return name === "" ? address : name;
}

function senderAddress(parsed: ParsedMail) {
  const address = addressOf(parsed.from);

  return ADDRESS.test(address) ? address : null;
}

function recipientText(parsed: ParsedMail, rcptTo: string) {
  const { to: parsedTo } = parsed;
  let to: AddressObject[] = [];

  if (Array.isArray(parsedTo)) {
    to = parsedTo;
  } else if (parsedTo !== undefined) {
    to = [parsedTo];
  }

  const recipients = to.flatMap((entry) =>
    entry.value.flatMap((one) => (one.address === undefined ? [] : [one.address])),
  );

  return recipients.length === 0 ? rcptTo : recipients.join(", ");
}

function subjectOf(parsed: ParsedMail) {
  const subject = (parsed.subject ?? "")
    .replaceAll(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, INBOUND_COPY_SUBJECT_MAX);

  return subject === "" ? "(no subject)" : subject;
}

function previewOf(parsed: ParsedMail) {
  const { text } = parsed;

  if (text === undefined || text.trim() === "") {
    return { text: "This message has no plain-text part.", truncated: false, htmlOnly: true };
  }

  const preview = truncateBytes(text, INBOUND_COPY_PREVIEW_BYTES);

  return { text: preview, truncated: preview.length < text.length, htmlOnly: false };
}

function attachmentName(attachment: Attachment, index: number) {
  const name = (attachment.filename ?? "")
    .replaceAll(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, 255);

  return name === "" ? `attachment-${String(index + 1)}` : name;
}

function attachmentType(attachment: Attachment) {
  const candidate = attachment.contentType.trim().toLowerCase();

  return SAFE_MIME_TYPE.test(candidate) ? candidate : "application/octet-stream";
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

function encodedBytes(bytes: number) {
  return Math.ceil(bytes / 3) * 4;
}

function forwardedHeaders(parsed: ParsedMail) {
  const kept: Record<string, string> = {};
  const seen = new Set<string>();
  let named = 0;
  let totalBytes = 0;

  for (const { key, line } of parsed.headerLines) {
    const name = key.trim();
    const lower = name.toLowerCase();
    const custom = CUSTOM_HEADER.test(lower);
    const allowed = ALLOWED.has(lower);

    if (!custom && !allowed) {
      continue;
    }

    if (seen.has(lower) || (!custom && named >= MAX_CUSTOM_HEADERS)) {
      continue;
    }

    const colon = line.indexOf(":");

    const value = truncateBytes(
      (colon === -1 ? line : line.slice(colon + 1)).replaceAll(/[\r\n]+/gu, " ").trim(),
      MAX_HEADER_VALUE_BYTES,
    );

    if (value === "") {
      continue;
    }

    const cost = byteLength(name) + byteLength(value) + 4;

    if (totalBytes + cost > MAX_HEADER_BYTES) {
      continue;
    }

    kept[name] = value;
    seen.add(lower);
    totalBytes += cost;

    if (!custom) {
      named += 1;
    }
  }

  return kept;
}

/**
 * Whether forwarding this message would loop back into Overture: an auto-submitted reply, a message
 * already marked with our `X-Loop`, or a sender on one of Overture's own domains.
 * @param parsed The parsed inbound message.
 * @param domains The alias, sending and apex domains that belong to Overture.
 * @returns The reason to skip the copy, or null when the message is safe to copy.
 */
export function copyLoopReason(parsed: ParsedMail, domains: readonly string[]) {
  const autoSubmitted = headerText(parsed.headers.get("auto-submitted")).trim().toLowerCase();

  if (autoSubmitted !== "" && autoSubmitted !== "no") {
    return "auto_submitted";
  }

  const ownDomains = new Set(
    domains.flatMap((domain) => {
      const trimmed = domain.trim().toLowerCase();

      return trimmed === "" ? [] : [trimmed];
    }),
  );

  const xLoop = headerText(parsed.headers.get("x-loop")).toLowerCase();

  if ([...ownDomains].some((domain) => xLoop.includes(domain))) {
    return "x_loop";
  }

  if (ownDomains.has(domainOf(addressOf(parsed.from)))) {
    return "self_domain";
  }

  return null;
}

function copyAttachments(parsed: ParsedMail) {
  const attachments: OutboundCopyAttachment[] = [];
  let omitted = 0;

  for (const attachment of parsed.attachments) {
    if (attachment.related === true) {
      continue;
    }

    if (attachments.length >= INBOUND_COPY_MAX_ATTACHMENTS) {
      omitted += 1;

      continue;
    }

    attachments.push({
      content: new Uint8Array(attachment.content),
      disposition: attachment.contentDisposition === "inline" ? "inline" : "attachment",
      filename: attachmentName(attachment, attachments.length),
      type: attachmentType(attachment),
    });
  }

  return { attachments, omitted };
}

function sentAtText(date: Date | undefined) {
  if (date === undefined || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toUTCString();
}

function forwardedMessage(input: {
  parsed: ParsedMail;
  rcptTo: string;
  inboxUrl: string;
  attachments: readonly OutboundCopyAttachment[];
  omitted: number;
  keptInInbox: boolean;
}) {
  const { attachments, inboxUrl, keptInInbox, omitted, parsed, rcptTo } = input;
  const preview = previewOf(parsed);
  const sentAt = sentAtText(parsed.date);

  const paragraphs: string[] = [];

  if (preview.truncated) {
    paragraphs.push(
      "This message is longer than the copy, so it is truncated. Open it in Overture to read all of it.",
    );
  }

  if (preview.htmlOnly) {
    paragraphs.push("This message arrived as HTML. Open it in Overture to read it.");
  }

  if (attachments.length > 0) {
    paragraphs.push(
      keptInInbox
        ? "Attachments kept in your Overture Inbox:"
        : "Attachments are included with this email:",
    );
  }

  if (omitted > 0) {
    paragraphs.push(
      `This message has ${String(omitted)} more attachments. Open it in Overture to view them.`,
    );
  }

  const meta = [
    { label: "From", value: senderOf(parsed) },
    { label: "To", value: recipientText(parsed, rcptTo) },
    { label: "Subject", value: subjectOf(parsed) },
  ];

  if (sentAt !== null) {
    meta.push({ label: "Time", value: sentAt });
  }

  const rows = attachments.map((attachment) => ({
    meta: formatBytes(attachment.content.byteLength),
    name: attachment.filename,
  }));

  const template: EmailTemplateInput = {
    action: { label: "Open in Overture", url: inboxUrl },
    attachments: rows,
    heading: `New message to ${rcptTo}`,
    meta,
    paragraphs,
    preheader: `${senderOf(parsed)} wrote to ${rcptTo}.`,
    subject: subjectOf(parsed),
    why: `You are getting this because ${rcptTo} is your Overture application address and a copy of its mail goes to your sign-in email.`,
  };

  if (!preview.htmlOnly) {
    template.quote = { label: "Original message", text: preview.text };
  }

  if (senderAddress(parsed) !== null) {
    template.note = "Reply to this email to answer the sender directly.";
  }

  const rendered = renderEmail(template);

  return { body: rendered.text, html: rendered.html };
}

/**
 * Build the copy sent to an account's verified login email. A copy whose attachments would push it
 * over {@link INBOUND_COPY_MAX_BYTES} (or over the attachment count) leaves every attachment in the
 * Inbox and carries a sign-in link instead. The copy never renders inbound HTML.
 * @param input The parsed message, its envelope recipient and the Inbox link.
 * @returns The copy for the mail sender, without its recipient.
 */
export function inboundCopyOf(input: { parsed: ParsedMail; rcptTo: string; inboxUrl: string }) {
  const { inboxUrl, parsed, rcptTo } = input;
  const { attachments, omitted } = copyAttachments(parsed);
  const preview = previewOf(parsed).text;

  const wireBytes = attachments.reduce(
    (total, attachment) => total + encodedBytes(attachment.content.byteLength),
    0,
  );

  const keptInInbox = wireBytes + byteLength(preview) > INBOUND_COPY_MAX_BYTES;

  const headers = forwardedHeaders(parsed);
  const replyTo = senderAddress(parsed);

  const forwarded = forwardedMessage({
    attachments,
    inboxUrl,
    keptInInbox,
    omitted,
    parsed,
    rcptTo,
  });

  const copy: Omit<OutboundInboundCopyMail, "to"> = {
    body: forwarded.body,
    html: forwarded.html,
    subject: subjectOf(parsed),
  };

  if (replyTo !== null) {
    copy.replyTo = replyTo;
  }

  if (Object.keys(headers).length > 0) {
    copy.headers = headers;
  }

  if (!keptInInbox && attachments.length > 0) {
    copy.attachments = attachments;
  }

  return copy;
}
