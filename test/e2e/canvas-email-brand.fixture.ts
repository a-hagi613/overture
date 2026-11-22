import { renderRecapHtml } from "../../src/server/notify/recap-html.ts";

type RecapInput = Parameters<typeof renderRecapHtml>[0];

const base: RecapInput = {
  appOrigin: "http://127.0.0.1:3000",
  date: Date.UTC(2026, 10, 17, 7, 4),
  includeYesterday: true,
  needAnswer: 2,
  prompts: [
    "Are you comfortable with a weekly on-call rotation?",
    "How many years have you run Kubernetes in production?",
  ],
  ready: [
    {
      ats: "greenhouse",
      company: "Northwind Labs",
      location: "Remote, London",
      title: "Platform Engineer",
    },
    {
      ats: "lever",
      company: "Halden Systems",
      location: "Manchester, hybrid",
      title: "Site Reliability Engineer",
    },
    {
      ats: "ashby",
      company: "Larkspur Health",
      location: "Remote, UK",
      title: "Senior Backend Engineer",
    },
    {
      ats: "greenhouse",
      company: "Meridian Freight",
      location: "Chicago, IL",
      title: "Staff Engineer",
    },
    {
      ats: "lever",
      company: "Tessel Bio",
      location: "Remote, Canada",
      title: "Data Platform Engineer",
    },
    {
      ats: "ashby",
      company: "Ferro Cloud",
      location: "Remote, Canada",
      title: "DevOps Engineer",
    },
    {
      ats: "greenhouse",
      company: "Larkspur Health",
      location: "Vancouver, BC",
      title: "Platform Engineer",
    },
    {
      ats: "lever",
      company: "Meridian Freight",
      location: "Chicago, IL",
      title: "Site Reliability Engineer",
    },
    {
      ats: "ashby",
      company: "Tessel Bio",
      location: "Remote, Canada",
      title: "Data Platform Engineer",
    },
    {
      ats: "greenhouse",
      company: "Northwind Labs",
      location: "Toronto, ON",
      title: "Staff Platform Engineer",
    },
  ],
  replied: [
    { classification: "interview", company: "Halden Systems" },
    { classification: "other", company: "Northwind Labs" },
    { classification: "rejection", company: "Ferro Cloud" },
  ],
  sent: [
    {
      at: new Date(2026, 10, 16, 9, 42).getTime(),
      ats: "greenhouse",
      company: "Northwind Labs",
      location: "Toronto, ON",
      title: "Platform Engineer",
    },
    {
      at: new Date(2026, 10, 16, 12, 36).getTime(),
      ats: "lever",
      company: "Halden Systems",
      location: "Ottawa, ON",
      title: "Senior Backend Engineer",
    },
    {
      at: new Date(2026, 10, 16, 14, 3).getTime(),
      ats: "ashby",
      company: "Ferro Cloud",
      location: "Remote, Canada",
      title: "DevOps Engineer",
    },
  ],
  skipped: 3,
  subject: "Overture recap: 10 ready to approve, 2 need an answer",
  timeZone: "America/Toronto",
  unblocked: 4,
  url: "http://127.0.0.1:3000/ready",
};

export function sampleEmailHtml() {
  return renderRecapHtml(base);
}

export function digestEmailHtml() {
  const [sent] = base.sent;

  if (sent === undefined) {
    throw new Error("The email fixture needs one sent row.");
  }

  return renderRecapHtml({
    ...base,
    needAnswer: 1,
    prompts: ["Are you authorized to work in the US?"],
    ready: [],
    replied: base.replied,
    sent: [
      "Platform Engineer",
      "Senior Backend Engineer",
      "DevOps Engineer",
      "Site Reliability Engineer",
      "Data Platform Engineer",
      "Platform Engineer",
    ].map((title, index) => ({
      at: new Date(2026, 10, 16, 9, 12).getTime() + index * 90 * 60_000,
      ats: sent.ats,
      company: "Northwind Labs",
      location: "Toronto, ON",
      title,
    })),
    skipped: 3,
    subject: "Overture recap: 0 ready to approve, 1 need an answer",
    unblocked: 4,
  });
}

export function brandSheetHtml() {
  const images = [
    { file: "favicon-16.png", note: "16 × 16 · tab at 1×" },
    { file: "favicon-32.png", note: "32 × 32 · tab at 2×" },
    { file: "favicon-48.png", note: "48 × 48 · search results" },
    { file: "favicon.svg", note: "vector · tab, swaps under dark" },
    { file: "apple-touch-icon.png", note: "180 × 180 · iOS home screen" },
    { file: "icon-192.png", note: "192 × 192 · PWA" },
    { file: "icon-512.png", note: "512 × 512 · store listings" },
    { file: "icon-512-maskable.png", note: "512 · maskable (safe circle)" },
    { file: "avatar-400.png", note: "400 · social avatar" },
    { file: "og-image.png", note: "1200 × 630 · Open Graph" },
    { file: "twitter-card.png", note: "1200 × 600 · X large card" },
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
:root{--bg:#F3EEE4;--card:#FBF8F2;--ink:#151311;--mut:#5E5850;--line:rgba(21,19,17,.14);--line2:rgba(21,19,17,.28)}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Plus Jakarta Sans',system-ui,sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:56px 32px}
.serif{font-family:'Instrument Serif',Georgia,serif;font-weight:400}
h1{font:400 54px/1 'Instrument Serif',Georgia,serif;letter-spacing:-.02em;margin:0}
.lead{color:var(--mut);margin:12px 0 0;font-size:15px}
.lbl{font:600 10.5px sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.grid{display:flex;flex-wrap:wrap;gap:32px;margin-top:34px;align-items:flex-start}
.cell{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px}
.row{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.img{display:block;border-radius:6px;box-shadow:0 0 0 1px var(--line2)}
.wide{max-width:520px;height:auto;border-radius:8px}
.note{color:var(--mut);font-size:12px;margin:10px 0 0;font-family:'IBM Plex Mono',monospace}
</style></head><body><div class="wrap">
<p class="lbl">Overture · brand assets</p>
<h1 style="margin-top:12px">Drawn at their true pixel size</h1>
<p class="lead">The mark is ink, paper and ember. Favicons use the simplified ring; app icons are full-bleed ink.</p>
<div class="grid">${images
    .map(
      (image) =>
        `<div class="cell">${
          image.file.startsWith("og") || image.file.startsWith("twitter")
            ? `<img class="img wide" src="http://brand.test/icons/${image.file}" alt="">`
            : `<img class="img" src="http://brand.test/icons/${image.file}" alt="">`
        }<p class="note">${image.file} · ${image.note}</p></div>`,
    )
    .join("")}</div>
<div class="grid"><div class="cell"><img class="img" src="http://brand.test/icons/logo-horizontal-paper.svg" alt="" style="width:222px;height:auto"><p class="note">logo-horizontal-paper.svg</p></div>
<div class="cell" style="background:#151311"><img class="img" src="http://brand.test/icons/logo-horizontal-ink.svg" alt="" style="width:222px;height:auto;box-shadow:none"><p class="note" style="color:#ADA69B">logo-horizontal-ink.svg</p></div>
<div class="cell"><img class="img" src="http://brand.test/icons/logo-stacked-paper.svg" alt="" style="width:132px;height:auto"><p class="note">logo-stacked-paper.svg</p></div>
<div class="cell" style="background:#151311"><img class="img" src="http://brand.test/icons/logo-stacked-ink.svg" alt="" style="width:132px;height:auto;box-shadow:none"><p class="note" style="color:#ADA69B">logo-stacked-ink.svg</p></div></div>
</div></body></html>`;
}
