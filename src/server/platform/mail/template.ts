/**
 * The one Overture email template. Every message is a table-based document with
 * inline CSS, so Gmail, Outlook and a plain-text client read the same content:
 * the Ember mark and wordmark, the subject, the heading, an optional block of
 * machine facts, the CTA, and the footer that says why the person got it.
 *
 * Edit this file to change every Overture email at once. `bun run email:preview`
 * renders each kind to HTML and text for a local look.
 */

const FONT_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','Plus Jakarta Sans',Arial,sans-serif";

const FONT_SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif";

const FONT_MONO = "'IBM Plex Mono','Courier New',monospace";

/** Ember, copied from DESIGN.md as email clients cannot read CSS variables. */
export const EMAIL_COLORS = {
  background: "#F3EEE4",
  border: "rgba(21,19,17,0.14)",
  card: "#FBF8F2",
  darkBackground: "#191714",
  darkBorder: "rgba(242,237,228,0.14)",
  darkCard: "#221F1C",
  darkForeground: "#F2EDE4",
  darkMuted: "#ADA69B",
  darkSignal: "#F0743A",
  darkWell: "#2A2723",
  foreground: "#151311",
  muted: "#5E5850",
  signal: "#D2561F",
  well: "#E9E3D8",
} as const;

const MAX_SUBJECT_LENGTH = 180;

export interface EmailAction {
  label: string;
  url: string;
}

export interface EmailAttachment {
  meta: string;
  name: string;
}

export interface EmailMeta {
  label: string;
  value: string;
}

export interface EmailRow {
  detail?: string;
  meta?: string;
  title: string;
}

export interface EmailTemplateInput {
  action?: EmailAction;
  attachments?: readonly EmailAttachment[];
  /** The mono date on the right of the brand row. */
  date?: string;
  heading: string;
  meta?: readonly EmailMeta[];
  note?: string;
  paragraphs: readonly string[];
  preheader: string;
  preferences?: EmailAction;
  quote?: { label: string; text: string };
  rows?: readonly EmailRow[];
  subject: string;
  why: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Escape one value for HTML text and attributes. Every interpolation in the
 * template goes through it, so a sender's name, subject or message can never
 * become markup.
 * @param value The untrusted text.
 * @returns The same text with the five HTML-significant characters escaped.
 */
export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Keep a link only when it is an absolute HTTP(S) URL, so a crafted
 * `javascript:` or `data:` value never reaches an `href`.
 * @param value The candidate link.
 * @returns The normalised URL, or null when it must not be linked.
 */
export function safeHref(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function lineBreaks(escaped: string) {
  return escaped.replaceAll("\n", "<br>");
}

function paragraphHtml(paragraph: string) {
  return `<p class="oe-ink" style="margin:16px 0 0;font-family:${FONT_SANS};font-size:16px;line-height:1.55;color:${EMAIL_COLORS.foreground};">${lineBreaks(escapeHtml(paragraph))}</p>`;
}

function labelHtml(text: string) {
  return `<p class="oe-mut" style="margin:0;font-family:${FONT_MONO};font-size:10.5px;font-weight:600;letter-spacing:0.14em;line-height:1.5;text-transform:uppercase;color:${EMAIL_COLORS.muted};">${escapeHtml(text)}</p>`;
}

function markHtml() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:10px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="30" height="30" bgcolor="${EMAIL_COLORS.foreground}" class="oe-mark" style="width:30px;height:30px;background-color:${EMAIL_COLORS.foreground};border-radius:6px;"><tr><td align="center" valign="middle" width="30" height="30" style="position:relative;"><div class="oe-stroke" style="position:absolute;left:14px;top:4.5px;width:1.5px;height:21px;background-color:${EMAIL_COLORS.signal};border-radius:1px;font-size:0;line-height:0;"></div><div class="oe-ring" style="width:14px;height:14px;border:1.5px solid ${EMAIL_COLORS.card};border-radius:50%;font-size:0;line-height:0;">&nbsp;</div></td></tr></table></td><td valign="middle" class="oe-ink" style="font-family:${FONT_SERIF};font-size:24px;line-height:1;letter-spacing:-0.01em;color:${EMAIL_COLORS.foreground};">Overture</td></tr></table>`;
}

function actionHtml(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="oe-btn" bgcolor="${EMAIL_COLORS.foreground}" style="background-color:${EMAIL_COLORS.foreground};border-radius:6px;"><a class="oe-btn-link" href="${escapeHtml(url)}" rel="noopener" style="display:inline-block;padding:14px 26px;font-family:${FONT_SANS};font-size:15px;font-weight:600;line-height:1.2;color:${EMAIL_COLORS.card};text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function metaHtml(meta: readonly EmailMeta[]) {
  const rows = meta
    .map(
      (entry) =>
        `<tr><td class="oe-mut" valign="top" width="78" style="padding:9px 12px 0 0;font-family:${FONT_MONO};font-size:10.5px;font-weight:600;letter-spacing:0.12em;line-height:1.5;text-transform:uppercase;color:${EMAIL_COLORS.muted};">${escapeHtml(entry.label)}</td><td class="oe-ink" valign="top" style="padding:9px 0 0;font-family:${FONT_SANS};font-size:14px;line-height:1.5;color:${EMAIL_COLORS.foreground};word-break:break-word;overflow-wrap:anywhere;">${lineBreaks(escapeHtml(entry.value))}</td></tr>`,
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

function rowsHtml(rows: readonly EmailRow[]) {
  const body = rows
    .map((row) => {
      const detail =
        row.detail === undefined
          ? ""
          : `<br><span class="oe-mut" style="font-family:${FONT_SANS};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.muted};">${escapeHtml(row.detail)}</span>`;
      const meta =
        row.meta === undefined
          ? ""
          : `<td class="oe-mut" align="right" valign="top" style="padding:14px 0 0 12px;font-family:${FONT_MONO};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.muted};white-space:nowrap;">${escapeHtml(row.meta)}</td>`;

      return `<tr><td valign="top" style="padding:14px 0;border-top:1px solid ${EMAIL_COLORS.border};"><span class="oe-ink" style="font-family:${FONT_SANS};font-size:15px;font-weight:600;line-height:1.35;color:${EMAIL_COLORS.foreground};">${escapeHtml(row.title)}</span>${detail}</td>${meta}</tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>`;
}

function attachmentsHtml(attachments: readonly EmailAttachment[]) {
  const rows = attachments
    .map(
      (attachment) =>
        `<tr><td class="oe-ink" style="padding:8px 0 0;font-family:${FONT_SANS};font-size:14px;line-height:1.5;color:${EMAIL_COLORS.foreground};">${escapeHtml(attachment.name)}</td><td class="oe-mut" align="right" style="padding:8px 0 0;font-family:${FONT_MONO};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.muted};white-space:nowrap;">${escapeHtml(attachment.meta)}</td></tr>`,
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

function quoteLabel(label: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td>${labelHtml(label)}</td></tr></table>`;
}

function textOf(input: EmailTemplateInput) {
  const lines: string[] = [input.heading, ""];
  const paragraphs = input.paragraphs.filter((paragraph) => paragraph.trim() !== "");

  for (const paragraph of paragraphs) {
    lines.push(paragraph.trim(), "");
  }

  if (input.meta !== undefined && input.meta.length > 0) {
    for (const entry of input.meta) {
      lines.push(`${entry.label}: ${entry.value}`);
    }

    lines.push("");
  }

  if (input.quote !== undefined) {
    lines.push(`${input.quote.label}:`, input.quote.text, "");
  }

  if (input.rows !== undefined && input.rows.length > 0) {
    for (const row of input.rows) {
      const detail = row.detail === undefined ? "" : ` — ${row.detail}`;
      const meta = row.meta === undefined ? "" : ` (${row.meta})`;

      lines.push(`- ${row.title}${detail}${meta}`);
    }

    lines.push("");
  }

  if (input.attachments !== undefined && input.attachments.length > 0) {
    lines.push("Attachments:");

    for (const attachment of input.attachments) {
      lines.push(`- ${attachment.name} (${attachment.meta})`);
    }

    lines.push("");
  }

  if (input.action !== undefined) {
    lines.push(`${input.action.label}: ${input.action.url}`, "");
  }

  if (input.note !== undefined && input.note !== "") {
    lines.push(input.note, "");
  }

  lines.push("—", input.why);

  if (input.preferences !== undefined) {
    lines.push(`${input.preferences.label}: ${input.preferences.url}`);
  }

  lines.push("Overture · no-reply@tryoverture.com");

  return lines.join("\n");
}

/**
 * Render one email to its HTML and plain-text parts from the same input, so
 * the two never disagree and every value is escaped once for both.
 * @param input Every fact the email shows.
 * @returns The HTML document and the accurate plain-text part.
 */
export function renderEmail(input: EmailTemplateInput): RenderedEmail {
  const subject = input.subject
    .replaceAll(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, MAX_SUBJECT_LENGTH);
  const heading = escapeHtml(input.heading);
  const paragraphs = input.paragraphs.filter((paragraph) => paragraph.trim() !== "");

  const metaSection =
    input.meta === undefined || input.meta.length === 0
      ? ""
      : `<tr><td style="padding:26px 36px 0;" class="oe-pad">${metaHtml(input.meta)}</td></tr>`;

  const rowsSection =
    input.rows === undefined || input.rows.length === 0
      ? ""
      : `<tr><td style="padding:26px 36px 0;" class="oe-pad">${rowsHtml(input.rows)}</td></tr>`;

  const quoteSection =
    input.quote === undefined
      ? ""
      : `<tr><td style="padding:26px 36px 0;" class="oe-pad">${quoteLabel(input.quote.label)}<div class="oe-quote" style="margin-top:8px;padding:18px 20px;background-color:${EMAIL_COLORS.background};border:1px solid ${EMAIL_COLORS.border};border-radius:10px;font-family:${FONT_SANS};font-size:14px;line-height:1.6;color:${EMAIL_COLORS.foreground};word-break:break-word;overflow-wrap:anywhere;">${lineBreaks(escapeHtml(input.quote.text))}</div></td></tr>`;

  const attachmentsSection =
    input.attachments === undefined || input.attachments.length === 0
      ? ""
      : `<tr><td style="padding:26px 36px 0;" class="oe-pad">${labelHtml("Attachments")}<div style="margin-top:8px;">${attachmentsHtml(input.attachments)}</div></td></tr>`;

  const actionUrl = input.action === undefined ? null : safeHref(input.action.url);

  const actionSection =
    input.action === undefined || actionUrl === null
      ? ""
      : `<tr><td style="padding:30px 36px 0;" class="oe-pad">${actionHtml(input.action.label, actionUrl)}</td></tr>`;

  const noteSection =
    input.note === undefined || input.note === ""
      ? ""
      : `<tr><td style="padding:14px 36px 0;" class="oe-pad"><p class="oe-mut" style="margin:0;font-family:${FONT_SANS};font-size:13px;line-height:1.55;color:${EMAIL_COLORS.muted};">${escapeHtml(input.note)}</p></td></tr>`;

  const preferencesUrl = input.preferences === undefined ? null : safeHref(input.preferences.url);

  const preferencesSection =
    input.preferences === undefined || preferencesUrl === null
      ? ""
      : `<p style="margin:10px 0 0;"><a class="oe-mut" href="${escapeHtml(preferencesUrl)}" rel="noopener" style="font-family:${FONT_SANS};font-size:12.5px;line-height:1.6;color:${EMAIL_COLORS.muted};text-decoration:underline;">${escapeHtml(input.preferences.label)}</a></p>`;

  const dateSection =
    input.date === undefined || input.date === ""
      ? ""
      : `<td align="right" valign="middle" class="oe-date oe-mut" style="font-family:${FONT_MONO};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.muted};white-space:nowrap;">${escapeHtml(input.date)}</td>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>
body{margin:0;padding:0;}
a{text-decoration:none;}
@media (max-width:520px){.oe-pad{padding-left:20px!important;padding-right:20px!important}.oe-heading{font-size:28px!important}.oe-page-gutter{padding:28px 10px 36px!important}.oe-date{display:none!important}}
@media (prefers-color-scheme:dark){.oe-page{background-color:${EMAIL_COLORS.darkBackground}!important}.oe-card{background-color:${EMAIL_COLORS.darkCard}!important;border-color:${EMAIL_COLORS.darkBorder}!important}.oe-ink{color:${EMAIL_COLORS.darkForeground}!important}.oe-mut{color:${EMAIL_COLORS.darkMuted}!important}.oe-rule{background-color:${EMAIL_COLORS.darkBorder}!important}.oe-quote{background-color:${EMAIL_COLORS.darkWell}!important;border-color:${EMAIL_COLORS.darkBorder}!important;color:${EMAIL_COLORS.darkForeground}!important}.oe-mark{background-color:${EMAIL_COLORS.darkForeground}!important}.oe-ring{border-color:${EMAIL_COLORS.darkBackground}!important}.oe-stroke{background-color:${EMAIL_COLORS.darkSignal}!important}.oe-btn{background-color:${EMAIL_COLORS.darkForeground}!important}.oe-btn-link{color:${EMAIL_COLORS.darkBackground}!important}}
</style>
</head>
<body class="oe-page" style="margin:0;padding:0;background-color:${EMAIL_COLORS.background};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-family:${FONT_SANS};font-size:1px;line-height:1px;color:${EMAIL_COLORS.background};">${escapeHtml(input.preheader)}</div>
<div role="main" aria-label="Overture email">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="oe-page" style="background-color:${EMAIL_COLORS.background};">
<tr><td class="oe-page-gutter" align="center" style="padding:48px 12px 56px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="oe-card" style="width:100%;max-width:600px;background-color:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.border};border-radius:12px;">
<tr><td class="oe-pad" style="padding:20px 36px 0;"><p class="oe-mut" style="margin:0;font-family:${FONT_MONO};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.muted};">Subject: <span class="oe-ink" style="color:${EMAIL_COLORS.foreground};">${escapeHtml(subject)}</span></p></td></tr>
<tr><td class="oe-pad" style="padding:22px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left" valign="middle">${markHtml()}</td>${dateSection}</tr></table></td></tr>
<tr><td class="oe-pad" style="padding:0 36px;"><div class="oe-rule" style="height:1px;background-color:${EMAIL_COLORS.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td class="oe-pad" style="padding:34px 36px 0;"><h1 class="oe-heading oe-ink" style="margin:0;font-family:${FONT_SERIF};font-size:40px;line-height:1.08;letter-spacing:-0.015em;font-weight:400;color:${EMAIL_COLORS.foreground};word-break:break-word;overflow-wrap:anywhere;">${heading}</h1></td></tr>
<tr><td class="oe-pad" style="padding:0 36px;">${paragraphs.map(paragraphHtml).join("")}</td></tr>
${metaSection}
${quoteSection}
${rowsSection}
${attachmentsSection}
${actionSection}
${noteSection}
<tr><td class="oe-pad" style="padding:0 36px;"><div class="oe-rule" style="height:1px;margin-top:26px;background-color:${EMAIL_COLORS.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td class="oe-pad" style="padding:20px 36px 30px;"><p class="oe-mut" style="margin:0;font-family:${FONT_SANS};font-size:12.5px;line-height:1.6;color:${EMAIL_COLORS.muted};">${escapeHtml(input.why)}</p>${preferencesSection}<p class="oe-mut" style="margin:14px 0 0;font-family:${FONT_MONO};font-size:11.5px;line-height:1.6;color:${EMAIL_COLORS.muted};">Overture · no-reply@tryoverture.com</p></td></tr>
</table>
</td></tr>
</table>
</div>
</body>
</html>`;

  return { html, text: textOf({ ...input, subject }) };
}
