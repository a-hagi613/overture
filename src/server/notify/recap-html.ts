import { renderMailHtml } from "./mail-html.ts";
import type { MailBlock } from "./mail-html.ts";

export interface RecapHtmlInput {
  logoUrl: string;
  needAnswer: number;
  ready: { title: string; company: string }[];
  replied: { company: string }[];
  sent: { title: string; company: string }[];
  subject: string;
  url: string;
}

/**
 * The HTML part of the recap email. It states the same facts as the plain-text
 * body, in the same order: Ready applications, open questions, what was sent
 * yesterday and which employers replied. Opening it never sends anything.
 * @param input The recap facts, the subject (used as preheader) and the review URL.
 * @returns The HTML document as a string.
 */
export function renderRecapHtml(input: RecapHtmlInput) {
  const blocks: MailBlock[] = [];

  if (input.ready.length === 0) {
    blocks.push({ kind: "text", text: "No new applications are ready to approve." });
  } else {
    blocks.push(
      {
        kind: "text",
        text:
          input.ready.length === 1
            ? "1 application is ready to approve:"
            : `${String(input.ready.length)} applications are ready to approve:`,
      },
      {
        kind: "list",
        label: "Ready to approve",
        items: input.ready.map((application) => `${application.title} at ${application.company}`),
      },
    );
  }

  if (input.needAnswer > 0) {
    blocks.push({
      kind: "text",
      text:
        input.needAnswer === 1
          ? "1 question needs an answer."
          : `${String(input.needAnswer)} questions need an answer.`,
    });
  }

  if (input.sent.length > 0) {
    blocks.push({
      kind: "list",
      label: "Sent yesterday",
      items: input.sent.map((application) => `${application.title} at ${application.company}`),
    });
  }

  if (input.replied.length > 0) {
    blocks.push({
      kind: "list",
      label:
        input.replied.length === 1 ? "1 employer replied yesterday" : "Employers replied yesterday",
      items: input.replied.map((reply) => reply.company),
    });
  }

  return renderMailHtml({
    blocks,
    cta: { label: "Review them", url: input.url },
    footer: [
      "You get this recap once a day when new applications are ready or something happened yesterday.",
      `Review them at ${input.url}`,
      "Overture",
    ],
    heading: "Overture recap",
    logoUrl: input.logoUrl,
    preheader: input.subject,
  });
}
