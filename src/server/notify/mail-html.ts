/**
 * The HTML part of an Overture email. One single column, inline-friendly, with
 * every colour taken from DESIGN.md §2 and a dark palette under
 * `prefers-color-scheme: dark`. The plain-text body is always sent alongside it.
 */

export type MailBlock =
  | { kind: "text"; text: string }
  | { kind: "list"; label: string; items: string[] };

export interface MailHtmlInput {
  logoUrl: string;
  preheader: string;
  heading: string;
  blocks: MailBlock[];
  cta?: { label: string; url: string };
  footer: string[];
}

const ENTITIES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

export function escapeHtml(value: string) {
  return value.replaceAll(/[&<>"']/gu, (character) => ENTITIES.get(character) ?? character);
}

function renderBlock(block: MailBlock) {
  if (block.kind === "text") {
    return `<p class="ink" style="margin:0 0 14px;font-size:16px;line-height:1.5">${escapeHtml(block.text)}</p>`;
  }

  const items = block.items
    .map(
      (item) =>
        `<li class="ink" style="margin:0 0 6px;font-size:15px;line-height:1.45">${escapeHtml(item)}</li>`,
    )
    .join("");

  return `<p class="lbl" style="margin:18px 0 8px">${escapeHtml(block.label)}</p><ul style="margin:0 0 14px;padding-left:20px">${items}</ul>`;
}

/**
 * Render one Overture email as a complete HTML document.
 * @param input The heading, ordered blocks, optional call to action and footer lines.
 * @returns The HTML document as a string.
 */
export function renderMailHtml(input: MailHtmlInput) {
  const blocks = input.blocks.map(renderBlock).join("");

  const cta = input.cta
    ? `<p style="margin:26px 0 0"><a class="btn" href="${escapeHtml(input.cta.url)}" style="display:inline-block;min-height:48px;line-height:48px;padding:0 26px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(input.cta.label)}</a></p>`
    : "";

  const footer = input.footer
    .map(
      (line) =>
        `<p class="mut" style="margin:0 0 8px;font-size:12.5px;line-height:1.6">${escapeHtml(line)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(input.heading)}</title>
<style>
body{margin:0;padding:0;background:#F3EEE4;font-family:-apple-system,'Segoe UI','Plus Jakarta Sans',Arial,sans-serif;-webkit-font-smoothing:antialiased}
.page{padding:32px 16px}
.card{max-width:600px;margin:0 auto;background:#FBF8F2;border:1px solid rgba(21,19,17,.14);border-radius:12px;padding:32px 36px}
.ink{color:#151311}
.mut{color:#5E5850}
.lbl{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#5E5850}
.btn{background:#151311;color:#FBF8F2}
.serif{font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-weight:400}
@media (prefers-color-scheme: dark){
body,.page{background:#191714 !important}
.card{background:#221F1C !important;border-color:rgba(242,237,228,.14) !important}
.ink{color:#F2EDE4 !important}
.mut,.lbl{color:#ADA69B !important}
.btn{background:#F2EDE4 !important;color:#191714 !important}
}
@media (max-width:520px){.card{padding:24px 20px !important}}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
<div class="page">
<div class="card" role="article">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr>
<td style="padding-right:10px"><img src="${escapeHtml(input.logoUrl)}" width="28" height="28" alt="" style="display:block;border:0"></td>
<td class="serif ink" style="font-size:24px;line-height:1">Overture</td>
</tr></table>
<h1 class="serif ink" style="margin:0 0 18px;font-size:30px;line-height:1.1">${escapeHtml(input.heading)}</h1>
${blocks}
${cta}
<div style="margin-top:28px;padding-top:18px;border-top:1px solid rgba(21,19,17,.14)">${footer}</div>
</div>
</div>
</body>
</html>
`;
}

/**
 * The Overture mark, served by the app, for the header of every email.
 * @param appOrigin The app origin, with or without a trailing slash.
 * @returns The absolute URL of the 192 px icon.
 */
export function mailLogoUrl(appOrigin: string) {
  return `${appOrigin.replace(/\/+$/u, "")}/icons/icon-192.png`;
}
