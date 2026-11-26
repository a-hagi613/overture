import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  accountDeletedEmail,
  billingPauseEmail,
  checkEmail,
  codeWaitEmail,
  exportReadyEmail,
  magicLinkEmail,
  notificationEmail,
  recapEmail,
  supportReplyEmail,
  supportRequestEmail,
  waitlistInviteEmail,
} from "../src/server/platform/mail/emails.ts";
import { renderEmail } from "../src/server/platform/mail/template.ts";

const ORIGIN = "https://app.tryoverture.com";
const READY = `${ORIGIN}/ready`;
const INBOX = `${ORIGIN}/inbox?message=preview-message`;

const forwardedCopy = renderEmail({
  action: { label: "Open in Overture", url: INBOX },
  attachments: [
    { meta: "184 KB", name: "Principal Engineer - job description.pdf" },
    { meta: "12 KB", name: "interview-times.ics" },
  ],
  heading: "New message to alex.chen@tryoverture.com",
  meta: [
    { label: "From", value: "Priya Raman <priya@northstar.example>" },
    { label: "To", value: "alex.chen@tryoverture.com" },
    { label: "Subject", value: "Your application — next steps" },
    { label: "Time", value: "Tue, 17 Nov 2026 09:30:00 GMT" },
  ],
  note: "Reply to this email to answer the sender directly.",
  paragraphs: ["Attachments are included with this email:"],
  preheader: "Priya Raman wrote to alex.chen@tryoverture.com.",
  quote: {
    label: "Original message",
    text: "Hello Alex,\n\nThank you for applying to the Platform Engineer role at Northwind Labs. We would like to invite you to a 45-minute call with the platform team.\n\nAre you free on Thursday afternoon?\n\nBest,\nPriya Raman\nTechnical Recruiter, Northwind Labs",
  },
  subject: "Your application — next steps",
  why: "You are getting this because alex.chen@tryoverture.com is your Overture application address and a copy of its mail goes to your sign-in email.",
});

const previews = {
  "account-deleted": accountDeletedEmail("Alex Chen"),
  "billing-pause": billingPauseEmail({
    copy: "Your payment did not go through, so sending is paused.",
    fix: "Choose a plan",
    subject: "Your Overture payment didn't go through",
    title: "Sending is paused",
    url: `${ORIGIN}/profile/billing`,
  }),
  check: checkEmail({ body: "Overture sent and received this message.", subject: "Mail check" }),
  "code-wait": codeWaitEmail({
    minutes: 10,
    subject: "Needs a verification code",
    url: `${ORIGIN}/home?codeWait=preview`,
  }),
  "export-ready": exportReadyEmail({
    subject: "Your Overture export is ready",
    url: `${ORIGIN}/profile/account`,
  }),
  "forwarded-copy": {
    body: forwardedCopy.text,
    html: forwardedCopy.html,
    subject: "Your application — next steps",
  },
  "magic-link": magicLinkEmail(`${ORIGIN}/api/auth/magic-link/verify?token=preview-token`),
  "notification-batch": notificationEmail({
    heading: "3 applications are ready",
    intro: "Overture prepared three applications while you were away.",
    items: [
      { detail: "Northwind Labs · Remote, London", meta: "Greenhouse", title: "Platform Engineer" },
      {
        detail: "Halden Systems · Manchester, hybrid",
        meta: "Lever",
        title: "Site Reliability Engineer",
      },
      { detail: "Larkspur Health · Remote, UK", meta: "Ashby", title: "Senior Backend Engineer" },
    ],
    subject: "3 applications ready to approve",
    url: READY,
  }),
  recap: recapEmail({
    needAnswer: 2,
    ready: [
      { company: "Northwind Labs", title: "Platform Engineer" },
      { company: "Halden Systems", title: "Site Reliability Engineer" },
    ],
    replied: [{ company: "Larkspur Health" }],
    sent: [{ company: "Northwind Labs", title: "Senior Backend Engineer" }],
    subject: "Overture recap: 2 ready to approve, 2 need an answer",
    url: READY,
  }),
  "support-reply": supportReplyEmail({
    message: "We fixed the duplicate charge and refunded the second one.",
    referenceId: "SUP-4F2A",
    subject: "Duplicate charge",
  }),
  "support-request": supportRequestEmail({
    category: "Billing",
    email: "alex@example.com",
    message: "I was charged twice for the Weekly plan.",
    name: "Alex Chen",
    referenceId: "SUP-4F2A",
    subject: "Duplicate charge",
  }),
  "waitlist-invite": waitlistInviteEmail(`${ORIGIN}/signin`),
} as const;

const outputDirectory = join("tmp", "email-preview");

mkdirSync(outputDirectory, { recursive: true });

const links: string[] = [];

for (const [name, email] of Object.entries(previews)) {
  writeFileSync(join(outputDirectory, `${name}.html`), email.html);
  writeFileSync(join(outputDirectory, `${name}.txt`), email.body);
  links.push(`<li><a href="${name}.html">${name}</a> · <a href="${name}.txt">text</a></li>`);
}

writeFileSync(
  join(outputDirectory, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Overture email previews</title><style>body{font-family:system-ui,sans-serif;padding:32px;background:#F3EEE4;color:#151311}li{margin:8px 0}a{color:#151311}</style></head><body><h1>Overture email previews</h1><ul>${links.join("")}</ul></body></html>`,
);

process.stdout.write(
  `Rendered ${String(Object.keys(previews).length)} emails to ${outputDirectory}\n`,
);

process.stdout.write(`Open ${join(outputDirectory, "index.html")}\n`);
