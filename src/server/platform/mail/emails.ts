/**
 * The Overture email builders. Each one produces the subject, the plain-text
 * part and the HTML part for one kind of mail, so an adapter only has to send
 * it. Copy stays in `src/shared/copy.ts` and the layout in `template.ts`.
 */

import { copy } from "../../../shared/copy.ts";

import type { EmailAction, EmailRow, EmailTemplateInput } from "./template.ts";

import { renderEmail, safeHref } from "./template.ts";

export interface BuiltEmail {
  body: string;
  html: string;
  subject: string;
}

export interface NotificationEmailItem {
  detail?: string;
  meta?: string;
  title: string;
}

export interface NotificationEmailInput {
  date?: string;
  heading: string;
  intro?: string;
  items: readonly NotificationEmailItem[];
  subject: string;
  url: string;
  why?: string;
}

function paragraphsOf(text: string, url?: string, omit: readonly string[] = []) {
  return text.split(/\n{2,}/u).flatMap((paragraph) => {
    const trimmed = paragraph.trim();

    return trimmed === "" || trimmed === "Overture" || trimmed === url || omit.includes(trimmed)
      ? []
      : [trimmed];
  });
}

function build(input: EmailTemplateInput): BuiltEmail {
  const rendered = renderEmail(input);

  return { body: rendered.text, html: rendered.html, subject: input.subject };
}

function preferencesFor(url: string) {
  const parsed = safeHref(url);

  if (parsed === null) {
    return undefined;
  }

  return { label: "Manage email preferences", url: new URL("/profile/account", parsed).toString() };
}

function withPreferences(input: {
  action?: EmailAction;
  date?: string;
  heading: string;
  note?: string;
  paragraphs: readonly string[];
  preheader: string;
  subject: string;
  url: string;
  why: string;
}): EmailTemplateInput {
  const template: EmailTemplateInput = {
    heading: input.heading,
    paragraphs: input.paragraphs,
    preheader: input.preheader,
    subject: input.subject,
    why: input.why,
  };

  if (input.action !== undefined) {
    template.action = input.action;
  }

  if (input.date !== undefined) {
    template.date = input.date;
  }

  if (input.note !== undefined) {
    template.note = input.note;
  }

  const preferences = preferencesFor(input.url);

  if (preferences !== undefined) {
    template.preferences = preferences;
  }

  return template;
}

/**
 * The sign-in link better-auth sends. The button opens the link, and the copy
 * says it works once.
 * @param url The one-time magic-link URL.
 * @returns The subject, text and HTML for the mail.
 */
export function magicLinkEmail(url: string) {
  return build({
    action: { label: "Open in Overture", url },
    heading: "Sign in to Overture",
    note: "If you didn't ask to sign in, you can ignore this email.",
    paragraphs: paragraphsOf(copy.mail.magicLinkBody(url), url),
    preheader: "Your one-time sign-in link, valid for 15 minutes.",
    subject: copy.mail.magicLinkSubject,
    why: "You are getting this because a sign-in link was requested for this email address.",
  });
}

/**
 * The invitation an approved waitlist entry receives.
 * @param url The sign-in page the invite opens.
 * @returns The subject, text and HTML for the mail.
 */
export function waitlistInviteEmail(url: string) {
  return build({
    action: { label: "Open in Overture", url },
    heading: "Your invite is ready",
    paragraphs: paragraphsOf(copy.mail.waitlistInviteBody(url), url),
    preheader: "Overture is ready for you.",
    subject: copy.mail.waitlistInviteSubject,
    why: "You are getting this because this email address asked to join Overture and its invite is ready.",
  });
}

/**
 * The confirmation that a deleted account is gone.
 * @param name The erased person's name.
 * @returns The subject, text and HTML for the mail.
 */
export function accountDeletedEmail(name: string) {
  return build({
    heading: "Your account has been deleted",
    paragraphs: paragraphsOf(copy.mail.accountDeletedBody(name)),
    preheader: "Your Overture account and its data have been erased.",
    subject: copy.mail.accountDeletedSubject,
    why: "You are getting this because this address asked Overture to delete its account.",
  });
}

/**
 * The fallback alert when a verification code cannot reach the person's phone.
 * @param input The notification's subject and the link to the paste sheet.
 * @returns The subject, text and HTML for the mail.
 */
export function codeWaitEmail(input: { minutes: number; subject: string; url: string }) {
  return build(
    withPreferences({
      action: { label: "Open in Overture", url: input.url },
      heading: "Paste your verification code",
      note: "Opening this email or its link never sends anything.",
      paragraphs: paragraphsOf(
        copy.mail.codeWaitBody({ minutes: input.minutes, url: input.url }),
        input.url,
      ),
      preheader: "An application is waiting for the code the employer emailed you.",
      subject: input.subject,
      url: input.url,
      why: "You are getting this because an application needed a verification code and your phone could not be reached.",
    }),
  );
}

/**
 * The one daily Recap email for a finished preparation run.
 * @param input The run's counts, the applications and the Ready page link.
 * @returns The subject, text and HTML for the mail.
 */
export function recapEmail(input: {
  needAnswer: number;
  ready: readonly { company: string; title: string }[];
  replied: readonly { company: string }[];
  sent: readonly { company: string; title: string }[];
  subject: string;
  url: string;
}) {
  return build(
    withPreferences({
      action: { label: "Open in Overture", url: input.url },
      heading: "Good morning.",
      note: "Opening this email or its link never sends anything.",
      paragraphs: paragraphsOf(
        copy.mail.recapBody({
          needAnswer: input.needAnswer,
          ready: input.ready.map((application) => ({
            company: application.company,
            title: application.title,
          })),
          replied: input.replied.map((reply) => ({ company: reply.company })),
          sent: input.sent.map((application) => ({
            company: application.company,
            title: application.title,
          })),
          url: input.url,
        }),
        input.url,
        [`Review them at ${input.url}`],
      ),
      preheader: "What Overture prepared and sent while you were away.",
      subject: input.subject,
      url: input.url,
      why: "You are getting this because the ready-to-approve email is on in your Overture settings. At most one a day, when new applications are ready.",
    }),
  );
}

/**
 * The notice that a data export is ready to download.
 * @param input The subject and the Profile link that starts the download.
 * @returns The subject, text and HTML for the mail.
 */
export function exportReadyEmail(input: { subject: string; url: string }) {
  return build(
    withPreferences({
      action: { label: "Open in Overture", url: input.url },
      heading: "Your export is ready",
      note: "The link is valid for 24 hours, then the archive is deleted.",
      paragraphs: paragraphsOf(copy.mail.exportReadyBody(input.url), input.url),
      preheader: "Your Overture data export is ready to download.",
      subject: input.subject,
      url: input.url,
      why: "You are getting this because this account asked Overture for a copy of its data.",
    }),
  );
}

/**
 * The one email that explains a billing pause and its fix.
 * @param input The pause copy and the Billing link that fixes it.
 * @returns The subject, text and HTML for the mail.
 */
export function billingPauseEmail(input: {
  copy: string;
  fix: string;
  subject: string;
  title: string;
  url: string;
}) {
  return build(
    withPreferences({
      action: { label: "Open in Overture", url: input.url },
      heading: input.title,
      paragraphs: paragraphsOf(
        copy.mail.billingPauseBody({
          copy: input.copy,
          fix: input.fix,
          title: input.title,
          url: input.url,
        }),
        input.url,
        [input.title],
      ),
      preheader: "Sending is paused until this is fixed.",
      subject: input.subject,
      url: input.url,
      why: "You are getting this because sending stopped on your Overture account and this notice is required.",
    }),
  );
}

/**
 * The support request that lands at Overture's support desk.
 * @param input Who asked, what they asked and the ticket reference.
 * @returns The subject, text and HTML for the mail.
 */
export function supportRequestEmail(input: {
  category: string;
  email: string;
  message: string;
  name: string;
  referenceId: string;
  subject: string;
}) {
  return build({
    heading: `Support request ${input.referenceId}`,
    meta: [
      { label: "From", value: `${input.name} <${input.email}>` },
      { label: "Category", value: input.category },
      { label: "Subject", value: input.subject },
    ],
    paragraphs: [],
    preheader: `${input.name} sent a support request.`,
    quote: { label: "Message", text: input.message },
    subject: copy.mail.supportSubject(input.referenceId, input.subject),
    why: "You are getting this because a signed-in person sent a support request to Overture.",
  });
}

/**
 * A reply from the support desk back to the person who wrote in.
 * @param input The reply body and the ticket reference.
 * @returns The subject, text and HTML for the mail.
 */
export function supportReplyEmail(input: {
  message: string;
  referenceId: string;
  subject: string;
}) {
  return build({
    heading: "A reply from Overture support",
    paragraphs: paragraphsOf(copy.mail.supportReplyBody(input.message, input.referenceId)),
    preheader: `Your reference is ${input.referenceId}.`,
    subject: copy.mail.supportReplySubject(input.referenceId, input.subject),
    why: "You are getting this because you wrote to Overture support and the desk answered.",
  });
}

/**
 * Overture's own live mail check, which proves the sending domain works.
 * @param input The check's subject and body.
 * @returns The subject, text and HTML for the mail.
 */
export function checkEmail(input: { body: string; subject: string }) {
  return build({
    heading: input.subject,
    paragraphs: paragraphsOf(input.body),
    preheader: "Overture's live mail check.",
    subject: input.subject,
    why: "You are getting this because Overture's mail check sent a test message to this address.",
  });
}

/**
 * One batched notification email: several grouped events, one row each, and
 * one link to the page that resolves them (#705).
 * @param input The batch's heading, rows and destination.
 * @returns The subject, text and HTML for the mail.
 */
export function notificationEmail(input: NotificationEmailInput) {
  const rows = input.items.map((item) => {
    const row: EmailRow = { title: item.title };

    if (item.detail !== undefined) {
      row.detail = item.detail;
    }

    if (item.meta !== undefined) {
      row.meta = item.meta;
    }

    return row;
  });

  const template = withPreferences({
    action: { label: "Open in Overture", url: input.url },
    heading: input.heading,
    paragraphs: input.intro === undefined ? [] : [input.intro],
    preheader: "What changed while you were away.",
    subject: input.subject,
    url: input.url,
    why:
      input.why ??
      "You are getting this because these notifications are on in your Overture settings.",
  });

  template.rows = rows;

  if (input.date !== undefined) {
    template.date = input.date;
  }

  return build(template);
}
