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

/**
 * The Overture mark, served by the app, for the header of every email.
 * @param appOrigin The app origin, with or without a trailing slash.
 * @returns The absolute URL of the 192 px icon.
 */
export function mailLogoUrl(appOrigin: string) {
  return `${appOrigin.replace(/\/+$/u, "")}/icons/icon-192.png`;
}

export interface MailDocumentInput {
  appOrigin: string;
  /** The inner HTML of the card, already escaped by the caller. */
  body: string;
  /** Footer paragraphs, escaped here. The last is the postal address. */
  footer: string[];
  /** Footer links under the paragraphs, after the body's one call to action. */
  links: { label: string; url: string }[];
  /** The short date on the right of the header, e.g. `Tue 17 Nov 2026`. */
  meta: string;
  /** The hidden preview line most clients show beside the subject. */
  preheader: string;
  title: string;
}

/**
 * Wrap one email's content in the shared Overture document: a 600 px single
 * column on paper, the mark and wordmark, and a dark palette. Table-free and
 * inline-friendly, as the Ready email board asks.
 * @param input The card body, title, preheader and app origin.
 * @returns The complete HTML document as a string.
 */
export function renderMailDocument(input: MailDocumentInput) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(input.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:0;background:#F3EEE4;-webkit-font-smoothing:antialiased}
.gnd{background:#F3EEE4}
.mail{background:#FBF8F2;border:1px solid rgba(21,19,17,.14);border-radius:12px;overflow:hidden}
.ink{color:#151311}
.mut{color:#5E5850}
.hair{border-color:rgba(21,19,17,.14)}
.hair2{border-color:rgba(21,19,17,.28)}
.well{background:#F3EEE4;border-color:rgba(21,19,17,.28)}
.btn{background:#151311;color:#FBF8F2}
.badge{background:#151311;color:#FBF8F2}
.need{color:#8E3A2C}
.needbg{background:#EFD9D3}
.link{color:#151311;text-decoration-color:rgba(21,19,17,.28)}
.serif{font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-weight:400}
.mono{font-family:'IBM Plex Mono','Courier New',monospace}
.lbl{font-family:-apple-system,'Segoe UI','Plus Jakarta Sans',Arial,sans-serif;font-size:10.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#5E5850}
@media (prefers-color-scheme: dark){
body,.gnd{background:#191714 !important}
.mail{background:#221F1C !important;border-color:rgba(242,237,228,.14) !important}
.ink{color:#F2EDE4 !important}
.mut,.lbl{color:#ADA69B !important}
.hair{border-color:rgba(242,237,228,.14) !important}
.hair2{border-color:rgba(242,237,228,.26) !important}
.well{background:#191714 !important;border-color:rgba(242,237,228,.26) !important}
.btn{background:#F2EDE4 !important;color:#191714 !important}
.badge{background:#F2EDE4 !important;color:#191714 !important}
.need{color:#E58A78 !important}
.needbg{background:#40261F !important}
.link{color:#F2EDE4 !important;text-decoration-color:rgba(242,237,228,.26) !important}
}
@media (max-width:520px){
.gnd{padding:16px 10px 24px !important}
.pad{padding-left:20px !important;padding-right:20px !important}
.hl{font-size:44px !important}
.rowt{display:block !important}
.rowt .when{text-align:left !important;margin-top:4px}
}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
<main class="gnd" style="padding:48px 20px 56px">
<div class="mail" role="article" aria-label="${escapeHtml(input.title)}" style="max-width:600px;margin:0 auto">

<div class="pad" style="padding:22px 36px;display:flex;align-items:center;justify-content:space-between;gap:12px">
<span style="display:inline-flex;align-items:center;gap:10px"><img src="${escapeHtml(mailLogoUrl(input.appOrigin))}" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px"><span class="serif ink" style="font-size:26px;line-height:1;letter-spacing:-.01em">Overture</span></span>
<span class="mono mut" style="font-size:12px">${escapeHtml(input.meta)}</span>
</div>
<hr class="hair" style="border:0;border-top-width:1px;border-top-style:solid;margin:0">
${input.body}
<hr class="hair" style="border:0;border-top-width:1px;border-top-style:solid;margin:22px 0 0">
<div class="pad mut" style="padding:22px 36px 30px;font-size:12.5px;line-height:1.6">
${input.footer.map((line) => `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`).join("\n")}
${
  input.links.length === 0
    ? ""
    : `<p style="margin:10px 0 0">${input.links
        .map(
          (link) =>
            `<a class="link" href="${escapeHtml(link.url)}" style="text-decoration:underline;text-underline-offset:3px">${escapeHtml(link.label)}</a>`,
        )
        .join(" · ")}</p>`
}
</div>

</div>
</main>
</body>
</html>
`;
}
