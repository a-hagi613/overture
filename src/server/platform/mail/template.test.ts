import { describe, expect, test } from "bun:test";

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
} from "./emails.ts";
import { EMAIL_COLORS, escapeHtml, renderEmail, safeHref } from "./template.ts";

const INBOX = "https://overture.test/inbox?message=message-1";
const READY = "https://overture.test/ready";

describe("branded email template", () => {
  test("every kind carries a branded HTML part and an accurate text part", () => {
    const emails = [
      magicLinkEmail("https://overture.test/api/auth/magic-link/verify?token=abc"),
      waitlistInviteEmail("https://overture.test/signin"),
      accountDeletedEmail("Ada Lovelace"),
      codeWaitEmail({ minutes: 10, subject: "Needs a verification code", url: INBOX }),
      recapEmail({
        needAnswer: 2,
        ready: [{ company: "Northwind Labs", title: "Platform Engineer" }],
        replied: [{ company: "Halden Systems" }],
        sent: [{ company: "Larkspur Health", title: "Backend Engineer" }],
        subject: "Overture recap: 1 ready to approve, 2 need an answer",
        url: READY,
      }),
      exportReadyEmail({ subject: "Your Overture export is ready", url: READY }),
      billingPauseEmail({
        copy: "A payment did not go through.",
        fix: "Choose a plan",
        subject: "Your Overture payment didn't go through",
        title: "Sending is paused",
        url: READY,
      }),
      supportRequestEmail({
        category: "Billing",
        email: "maya@example.test",
        message: "We fixed the duplicate charge.",
        name: "Maya Chen",
        referenceId: "SUP-0001",
        subject: "Duplicate charge",
      }),
      supportReplyEmail({
        message: "We fixed the duplicate charge.",
        referenceId: "SUP-0001",
        subject: "Duplicate charge",
      }),
      checkEmail({ body: "Overture can send mail.", subject: "Mail check" }),
      notificationEmail({
        heading: "3 applications are ready",
        intro: "Overture prepared three applications while you were away.",
        items: [
          { detail: "Northwind Labs · Remote", meta: "Greenhouse", title: "Platform Engineer" },
          { title: "Backend Engineer" },
        ],
        subject: "3 applications ready to approve",
        url: READY,
      }),
    ];

    for (const email of emails) {
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.body.length).toBeGreaterThan(0);
      expect(email.html).toStartWith("<!doctype html>");
      expect(email.html).toContain('role="presentation"');
      expect(email.html).toContain('role="main"');
      expect(email.html).toContain('class="oe-card"');
      expect(email.html).toContain("Overture");
      expect(email.html).toContain("no-reply@tryoverture.com");
      expect(email.html).not.toContain("<script");
      expect(email.body).toContain("—");
      expect(email.body).toContain("Overture · no-reply@tryoverture.com");
    }
  });

  test("recap and notification emails render their grouped rows in both parts", () => {
    const recap = recapEmail({
      needAnswer: 1,
      ready: [{ company: "Northwind Labs", title: "Platform Engineer" }],
      replied: [],
      sent: [],
      subject: "Overture recap: 1 ready to approve, 1 needs an answer",
      url: READY,
    });

    expect(recap.html).toContain("Platform Engineer at Northwind Labs");
    expect(recap.body).toContain("Platform Engineer at Northwind Labs");

    const batch = notificationEmail({
      heading: "3 applications are ready",
      items: [{ detail: "Halden Systems", title: "Site Reliability Engineer" }],
      subject: "3 applications ready to approve",
      url: READY,
    });

    expect(batch.html).toContain("Site Reliability Engineer");
    expect(batch.html).toContain("Halden Systems");
    expect(batch.body).toContain("Site Reliability Engineer — Halden Systems");
  });

  test("the forwarded copy names the alias, sender, subject, time and body", () => {
    const rendered = renderEmail({
      action: { label: "Open in Overture", url: INBOX },
      attachments: [{ meta: "120 KB", name: "brief.pdf" }],
      heading: "New message to alex.chen@tryoverture.com",
      meta: [
        { label: "From", value: "Priya Raman <priya@northstar.example>" },
        { label: "Subject", value: "Your application" },
        { label: "Time", value: "Tue, 17 Nov 2026 09:30:00 GMT" },
      ],
      paragraphs: ["Attachments kept in your Overture Inbox:"],
      preheader: "Priya Raman wrote to alex.chen@tryoverture.com.",
      quote: { label: "Original message", text: "Hello Ada.\nWe would like to talk." },
      subject: "Your application",
      why: "You are getting this because alex.chen@tryoverture.com is your Overture application address.",
    });

    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain("New message to alex.chen@tryoverture.com");
      expect(part).toContain("Your application");
      expect(part).toContain("Tue, 17 Nov 2026 09:30:00 GMT");
      expect(part).toContain("Hello Ada.");
      expect(part).toContain("brief.pdf");
      expect(part).toContain("Attachments kept in your Overture Inbox:");
    }

    expect(rendered.text).toContain("Priya Raman <priya@northstar.example>");
    expect(rendered.html).toContain("Priya Raman &lt;priya@northstar.example&gt;");
    expect(rendered.html).toContain("Hello Ada.<br>We would like to talk.");
    expect(rendered.html).toContain(`href="${INBOX}"`);
  });

  test("user values are escaped in the header, body, metadata, quote and footer", () => {
    const rendered = renderEmail({
      action: { label: '<img src=x onerror="alert(1)">', url: INBOX },
      attachments: [{ meta: "<b>1 MB</b>", name: '<script>alert("file")</script>' }],
      heading: '<script>alert("heading")</script>',
      meta: [{ label: '"><script>', value: "a&b <c>" }],
      paragraphs: ['<a href="javascript:alert(1)">click</a>'],
      preheader: "<b>preheader</b>",
      quote: { label: "<svg onload=alert(1)>", text: '</div><img src=x onerror="alert(1)">' },
      rows: [{ detail: "<script>detail</script>", meta: "<i>meta</i>", title: "<b>row</b>" }],
      subject: "Hello\r\nBcc: evil@example.test",
      why: '<script>alert("why")</script>',
    });

    expect(rendered.html).not.toContain("<script");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("<svg");
    expect(rendered.html).not.toContain("<b>1 MB</b>");
    expect(rendered.html).not.toContain('"><script>');
    expect(rendered.html).toContain("&lt;script&gt;alert(&quot;heading&quot;)&lt;/script&gt;");
    expect(rendered.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(rendered.html).toContain("a&amp;b &lt;c&gt;");
    expect(rendered.html).toContain("&lt;/div&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(rendered.html).toContain("Hello Bcc: evil@example.test");
    expect(rendered.text).toContain('<script>alert("heading")</script>');
  });

  test("an action URL with a query string is attribute-escaped", () => {
    const rendered = renderEmail({
      action: { label: "Open in Overture", url: "https://overture.test/x?a=1&b=2" },
      heading: "Sign in",
      paragraphs: [],
      preheader: "Sign in",
      subject: "Sign in",
      why: "Because you asked.",
    });

    expect(rendered.html).toContain('href="https://overture.test/x?a=1&amp;b=2"');
    expect(rendered.text).toContain("https://overture.test/x?a=1&b=2");
  });

  test("a non-http action URL never reaches an href", () => {
    const scriptUrl = ["java", "script:alert(1)"].join("");

    const rendered = renderEmail({
      action: { label: "Open in Overture", url: scriptUrl },
      heading: "Sign in",
      paragraphs: [],
      preheader: "Sign in",
      subject: "Sign in",
      why: "Because you asked.",
    });

    expect(rendered.html).not.toContain(scriptUrl);
    expect(rendered.html).not.toContain("Open in Overture");
    expect(safeHref(scriptUrl)).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref("mailto:admin@tryoverture.com")).toBeNull();
    expect(safeHref("https://overture.test/ready")).toBe("https://overture.test/ready");
  });

  test("the layout uses Ember colours inline and keeps dark-mode overrides", () => {
    const email = magicLinkEmail("https://overture.test/api/auth/magic-link/verify?token=abc");

    expect(email.html).toContain(`background-color:${EMAIL_COLORS.background}`);
    expect(email.html).toContain(`background-color:${EMAIL_COLORS.card}`);
    expect(email.html).toContain(`color:${EMAIL_COLORS.foreground}`);
    expect(email.html).toContain(EMAIL_COLORS.signal);
    expect(email.html).toContain("@media (prefers-color-scheme:dark)");
    expect(email.html).toContain('name="color-scheme" content="light dark"');
    expect(email.html).toContain("@media (max-width:520px)");
    expect(email.html).toContain("display:none");
    expect(email.html).toContain("max-width:600px");
  });

  test("escapeHtml leaves no HTML-significant character unescaped", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
