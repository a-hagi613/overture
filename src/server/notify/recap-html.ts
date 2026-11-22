import { copy } from "../../shared/copy.ts";
import { escapeHtml, renderMailDocument } from "../../shared/mail-html.ts";

export interface RecapApplication {
  ats: string;
  company: string;
  location: string | null;
  title: string;
}

export interface RecapSent extends RecapApplication {
  at: number;
}

export interface RecapReply {
  classification: keyof typeof copy.mail.recapReplyKind;
  company: string;
}

export interface RecapHtmlInput {
  appOrigin: string;
  /** The user's local date the run is summarised for. */
  date: number;
  includeYesterday: boolean;
  needAnswer: number;
  /** How many Applications answering the open questions lets go ahead. */
  unblocked: number;
  prompts: string[];
  ready: RecapApplication[];
  replied: RecapReply[];
  sent: RecapSent[];
  /** Applications the user skipped yesterday, shown in the away summary. */
  skipped: number;
  subject: string;
  timeZone: string;
  url: string;
}

const READY_ROWS = 3;

function atsLabel(ats: string) {
  switch (ats) {
    case "ashby": {
      return "Ashby";
    }

    case "greenhouse": {
      return "Greenhouse";
    }

    case "lever": {
      return "Lever";
    }

    case "personio": {
      return "Personio";
    }

    case "workable": {
      return "Workable";
    }

    default: {
      return ats;
    }
  }
}

/**
 * The company initials a row shows in its mark, at most two letters.
 * @param company The employer's name.
 * @returns The initials, upper-cased.
 */
export function companyInitials(company: string) {
  const words = company
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .slice(0, 2);

  return words.map((word) => word.slice(0, 1).toUpperCase()).join("") || "·";
}

/**
 * The time an Application was sent at, in the user's zone, as the email shows
 * it: `11:42 pm`.
 * @param at The epoch the Application was sent at.
 * @param timeZone The user's IANA zone.
 * @returns The lower-case 12-hour time.
 */
export function mailTime(at: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    timeZone,
  })
    .format(new Date(at))
    .toLowerCase();
}

/**
 * The short date in the email header, as the board draws it: `Tue 17 Nov 2026`.
 * @param at The moment the email is about.
 * @param timeZone The user's IANA zone.
 * @returns The short date.
 */
export function mailDate(at: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
    year: "numeric",
  })
    .format(new Date(at))
    .replace(",", "");
}

function rowDetail(company: string, location: string | null) {
  return escapeHtml(
    location === null || location.trim() === "" ? company : `${company} · ${location}`,
  );
}

function readyRow(application: RecapApplication) {
  return `<div class="rowt hair" style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 0;border-top-width:1px;border-top-style:solid">
<span style="display:flex;align-items:flex-start;gap:12px;min-width:0">
<span class="badge mono" style="flex:none;width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600">${escapeHtml(companyInitials(application.company))}</span>
<span style="min-width:0"><span class="ink" style="display:block;font-size:15px;font-weight:600;line-height:1.35">${escapeHtml(application.title)}</span><span class="mut" style="display:block;font-size:13px">${rowDetail(application.company, application.location)}</span></span>
</span>
<span class="when mono mut" style="flex:none;font-size:12px">${escapeHtml(atsLabel(application.ats))}</span>
</div>`;
}

function sentRow(application: RecapSent, timeZone: string) {
  return `<div class="rowt hair" style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 0;border-top-width:1px;border-top-style:solid">
<span style="min-width:0"><span class="ink" style="display:block;font-size:15px;font-weight:600;line-height:1.35">${escapeHtml(application.title)}</span><span class="mut" style="display:block;font-size:13px">${rowDetail(application.company, application.location)}</span></span>
<span class="when mono mut" style="flex:none;text-align:right;font-size:12px">${escapeHtml(mailTime(application.at, timeZone))} · via ${escapeHtml(atsLabel(application.ats))}</span>
</div>`;
}

/**
 * The HTML part of the one Recap email. It states the same facts as the
 * plain-text body, in the same order: what the run filled in, what needs you,
 * yesterday's sends between 08:00 and 20:00, and who replied. Opening it never
 * sends anything.
 * @param input The recap facts, the subject (used as preheader) and the Ready URL.
 * @returns The HTML document as a string.
 */
export function renderRecapHtml(input: RecapHtmlInput) {
  const shown = input.ready.slice(0, READY_ROWS);
  const more = input.ready.length - shown.length;

  const readySection =
    shown.length === 0
      ? ""
      : `<div class="pad" style="padding:34px 36px 0">
<p class="lbl" style="margin:0">${escapeHtml(copy.mail.recapReadyLabel(input.ready.length))}</p>
<div style="margin-top:8px">${shown.map((application) => readyRow(application)).join("")}</div>
${
  more > 0
    ? `<p class="mut hair" style="margin:6px 0 0;padding-top:12px;border-top-width:1px;border-top-style:solid;font-size:13px">${escapeHtml(copy.mail.recapMore(more))}</p>`
    : ""
}
</div>`;

  const needsSection =
    input.needAnswer === 0
      ? ""
      : `<div class="pad" style="padding:34px 36px 0">
<p class="lbl" style="margin:0 0 8px">${escapeHtml(copy.mail.recapNeedsLabel(input.needAnswer))}</p>
<div class="well" style="background:#F3EEE4;border-width:1px;border-style:solid;border-radius:10px;padding:22px 24px">
<span class="needbg need" style="display:inline-block;padding:3px 11px;border-radius:999px;font-size:12px;font-weight:600">${escapeHtml(copy.mail.recapNeedsPill(input.needAnswer))}</span>
${input.prompts
  .slice(0, 2)
  .map(
    (prompt) =>
      `<p class="serif ink" style="margin:14px 0 0;font-size:24px;line-height:1.18">${escapeHtml(prompt)}</p>`,
  )
  .join("")}
${
  input.unblocked > 0
    ? `<p class="mut" style="margin:10px 0 0;font-size:13.5px">${escapeHtml(copy.mail.recapQuestionsNote(input.unblocked))}</p>`
    : ""
}
</div>
</div>`;

  const sentSection =
    !input.includeYesterday || input.sent.length === 0
      ? ""
      : `<div class="pad" style="padding:34px 36px 0">
<p class="lbl" style="margin:0">${escapeHtml(copy.mail.recapSentLabel(input.sent.length))}</p>
<p class="mut" style="margin:4px 0 0;font-size:12.5px">${escapeHtml(copy.mail.recapSentWindow)}</p>
<div style="margin-top:6px">${input.sent.map((application) => sentRow(application, input.timeZone)).join("")}</div>
</div>`;

  const repliedSection =
    !input.includeYesterday || input.replied.length === 0
      ? ""
      : `<div class="pad" style="padding:34px 36px 0">
<p class="lbl" style="margin:0">${escapeHtml(copy.mail.recapRepliesLabel(input.replied.length))}</p>
<div style="margin-top:6px">${input.replied
          .map(
            (reply) =>
              `<div class="hair" style="padding:14px 0;border-top-width:1px;border-top-style:solid"><span class="ink" style="display:block;font-size:15px;font-weight:600;line-height:1.35">${escapeHtml(copy.mail.recapReplyKind[reply.classification])}</span><span class="mut" style="display:block;font-size:13px">${escapeHtml(reply.company)}</span></div>`,
          )
          .join("")}</div>
</div>`;

  const awayLine = input.includeYesterday
    ? `<p class="mut" style="margin:14px 0 0;font-size:15px">${escapeHtml(
        copy.mail.recapAway({
          needAnswer: input.needAnswer,
          sent: input.sent.length,
          skipped: input.skipped,
        }),
      )}</p>`
    : "";

  const body = `<div class="pad" style="padding:34px 36px 6px">
<h1 class="serif ink hl" style="margin:0;font-size:56px;line-height:1;letter-spacing:-.02em;font-weight:400">${escapeHtml(copy.mail.recapHeading)}</h1>
<p class="ink" style="margin:16px 0 0;font-size:17px;line-height:1.5">${escapeHtml(copy.mail.recapIntro(input.ready.length))}</p>
${awayLine}
</div>
${readySection}
${needsSection}
${sentSection}
${repliedSection}
<div class="pad" style="padding:30px 36px 12px">
<a class="btn" href="${escapeHtml(input.url)}" style="display:inline-block;min-height:48px;line-height:48px;padding:0 26px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none">Review and send</a>
<p class="mut" style="margin:14px 0 0;font-size:13px">Opening this email or its link never sends anything.</p>
</div>`;

  return renderMailDocument({
    appOrigin: input.appOrigin,
    body,
    footer: [
      copy.mail.recapFooterWhy,
      copy.mail.recapFooterWhen,
      copy.mail.recapFooterHours,
      "Overture · [POSTAL ADDRESS]",
    ],
    links: [
      { label: copy.mail.recapManage, url: `${input.appOrigin.replace(/\/+$/u, "")}/settings` },
      {
        label: copy.mail.recapUnsubscribe,
        url: `${input.appOrigin.replace(/\/+$/u, "")}/settings`,
      },
    ],
    meta: mailDate(input.date, input.timeZone),
    preheader: input.subject,
    title: input.subject,
  });
}
