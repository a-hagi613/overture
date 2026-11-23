import type { Attachment, Email } from "postal-mime";

import type { InboundMailEnv, OutboundAttachment, OutboundEmail } from "./env.ts";
import { forwardedHeaders } from "./headers.ts";
import { byteLength, truncateBytes } from "./text.ts";

export const INBOUND_FORWARD_MAX_BYTES = 4 * 1024 * 1024;
export const INBOUND_FORWARD_MAX_ATTACHMENTS = 32;
export const INBOUND_FORWARD_PREVIEW_BYTES = 200 * 1024;
export const INBOUND_FORWARD_HTML_PREVIEW_BYTES = 512 * 1024;
export const INBOUND_FORWARD_SUBJECT_MAX = 998;
export const INBOUND_ATTACHMENT_SPILL_PREFIX = "mail-attachments/";
export const DEFAULT_FORWARD_FROM = "notify@notify.tryoverture.com";

const INBOX_PATH = "/inbox";
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/u;
const SAFE_MIME_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u;

interface PreparedAttachment {
  attachment: Attachment;
  index: number;
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

interface SpilledAttachment {
  filename: string;
  bytes: number;
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

function encodedBytes(bytes: number) {
  return Math.ceil(bytes / 3) * 4;
}

function attachmentBytes(attachment: Attachment) {
  const { content } = attachment;

  if (content instanceof Uint8Array) {
    return Uint8Array.from(content);
  }

  if (content instanceof ArrayBuffer) {
    return Uint8Array.from(new Uint8Array(content));
  }

  return Uint8Array.from(atob(content), (character) => character.codePointAt(0) ?? 0);
}

function attachmentName(attachment: Attachment, index: number) {
  const name = (attachment.filename ?? "")
    .replaceAll(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, 255);

  return name === "" ? `attachment-${String(index + 1)}` : name;
}

function spillObjectName(filename: string, index: number) {
  const cleaned = filename.replaceAll(/[^A-Za-z0-9._-]+/gu, "_").slice(0, 80);

  return `${String(index + 1)}-${cleaned === "" ? "attachment" : cleaned}`;
}

function attachmentType(attachment: Attachment) {
  const candidate = attachment.mimeType.trim().toLowerCase();

  return SAFE_MIME_TYPE.test(candidate) ? candidate : "application/octet-stream";
}

function htmlToText(html: string) {
  return html
    .replaceAll(/<script[\s\S]*?<\/script>/giu, " ")
    .replaceAll(/<style[\s\S]*?<\/style>/giu, " ")
    .replaceAll(/<br\s*\/?>/giu, "\n")
    .replaceAll(/<\/p>/giu, "\n")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&quot;", '"')
    .replaceAll(/&#0?39;/gu, "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll(/[ \t]+/gu, " ")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
}

function previewOf(parsed: Email) {
  const { html, text: plain } = parsed;
  let text = "";

  if (plain !== undefined && plain.trim() !== "") {
    text = plain;
  } else if (html !== undefined && html !== "") {
    text = htmlToText(html.slice(0, INBOUND_FORWARD_HTML_PREVIEW_BYTES));
  }

  const preview = truncateBytes(text, INBOUND_FORWARD_PREVIEW_BYTES);

  return { text: preview, truncated: preview.length < text.length };
}

function subjectOf(parsed: Email) {
  const subject = (parsed.subject ?? "")
    .replaceAll(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, INBOUND_FORWARD_SUBJECT_MAX);

  return subject === "" ? "(no subject)" : subject;
}

function senderOf(parsed: Email) {
  const name = (parsed.from?.name ?? "").trim();
  const address = (parsed.from?.address ?? "").trim();

  if (name !== "" && address !== "") {
    return `${name} <${address}>`;
  }

  return name === "" ? address : name;
}

function senderAddress(parsed: Email) {
  const address = (parsed.from?.address ?? "").trim();

  return ADDRESS.test(address) ? address : null;
}

function recipientText(parsed: Email, rcptTo: string) {
  const recipients = (parsed.to ?? []).flatMap((entry) =>
    entry.address === undefined ? [] : [entry.address],
  );

  return recipients.length === 0 ? rcptTo : recipients.join(", ");
}

function forwardFrom(env: InboundMailEnv) {
  const configured = (env.FORWARD_FROM ?? "").trim();

  return ADDRESS.test(configured) ? configured : DEFAULT_FORWARD_FROM;
}

function preparedAttachments(parsed: Email) {
  const prepared: PreparedAttachment[] = [];
  let omitted = 0;

  for (const [index, attachment] of parsed.attachments.entries()) {
    if (attachment.related === true) {
      continue;
    }

    if (prepared.length >= INBOUND_FORWARD_MAX_ATTACHMENTS) {
      omitted += 1;

      continue;
    }

    prepared.push({
      attachment,
      index,
      filename: attachmentName(attachment, index),
      bytes: attachmentBytes(attachment),
    });
  }

  return { prepared, omitted };
}

async function spillAttachments(env: InboundMailEnv, prepared: readonly PreparedAttachment[]) {
  const reference = crypto.randomUUID();
  const writes: Promise<void>[] = [];
  const spilled: SpilledAttachment[] = [];

  for (const item of prepared) {
    writes.push(
      env.INBOUND_SPILL.put(
        `${INBOUND_ATTACHMENT_SPILL_PREFIX}${reference}/${spillObjectName(item.filename, item.index)}`,
        item.bytes,
      ),
    );

    spilled.push({ filename: item.filename, bytes: item.bytes.byteLength });
  }

  await Promise.all(writes);

  return spilled;
}

function outboundAttachments(prepared: readonly PreparedAttachment[]) {
  const attachments: OutboundAttachment[] = [];

  for (const item of prepared) {
    attachments.push({
      content: item.bytes,
      filename: item.filename,
      type: attachmentType(item.attachment),
      disposition: item.attachment.disposition === "inline" ? "inline" : "attachment",
    });
  }

  return attachments;
}

function forwardedText(
  parsed: Email,
  rcptTo: string,
  inboxUrl: string,
  spilled: readonly SpilledAttachment[],
  omitted: number,
) {
  const preview = previewOf(parsed);

  const lines = [
    `From: ${senderOf(parsed)}`,
    `To: ${recipientText(parsed, rcptTo)}`,
    `Subject: ${subjectOf(parsed)}`,
    "",
    preview.text,
  ];

  if (preview.truncated) {
    lines.push("", `[Message truncated. Open Overture for the full message: ${inboxUrl}]`);
  }

  if (spilled.length > 0) {
    lines.push("", "Attachments kept in Overture Inbox:");

    for (const attachment of spilled) {
      lines.push(`- ${attachment.filename} (${formatBytes(attachment.bytes)})`);
    }

    lines.push("", `Open Overture to view or download them: ${inboxUrl}`);
  }

  if (omitted > 0) {
    lines.push(
      "",
      `This message has ${String(omitted)} more attachments. Open Overture to view or download them: ${inboxUrl}`,
    );
  }

  return lines.join("\n");
}

export async function forwardInboundMail(env: InboundMailEnv, parsed: Email, rcptTo: string) {
  const send = env.INBOUND_EMAIL;

  if (send === undefined) {
    return false;
  }

  const inboxUrl = new URL(INBOX_PATH, env.OVERTURE_ORIGIN).toString();
  const { prepared, omitted } = preparedAttachments(parsed);
  const preview = previewOf(parsed).text;

  const attachmentWireBytes = prepared.reduce(
    (total, item) => total + encodedBytes(item.bytes.byteLength),
    0,
  );

  const mustSpill = attachmentWireBytes + byteLength(preview) > INBOUND_FORWARD_MAX_BYTES;

  const spilled = mustSpill ? await spillAttachments(env, prepared) : [];
  const attachments = mustSpill ? [] : outboundAttachments(prepared);

  const headers = forwardedHeaders(parsed.headers);
  const replyTo = senderAddress(parsed);

  const message: OutboundEmail = {
    from: forwardFrom(env),
    to: env.OWNER_FORWARD_TO,
    subject: subjectOf(parsed),
    text: forwardedText(parsed, rcptTo, inboxUrl, spilled, omitted),
  };

  if (replyTo !== null) {
    message.replyTo = replyTo;
  }

  if (Object.keys(headers).length > 0) {
    message.headers = headers;
  }

  if (attachments.length > 0) {
    message.attachments = attachments;
  }

  await send.send(message);

  return true;
}

export function shouldForwardAliasMail(parsed: Email, atsSender: boolean) {
  return atsSender || parsed.inReplyTo !== undefined || parsed.references !== undefined;
}
