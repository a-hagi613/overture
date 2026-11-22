import { expect, test } from "bun:test";

import { companyInitials, mailDate, mailTime, renderRecapHtml } from "./recap-html.ts";

const APP_ORIGIN = "https://tryoverture.example";

function recap(overrides: Partial<Parameters<typeof renderRecapHtml>[0]> = {}) {
  return renderRecapHtml({
    appOrigin: APP_ORIGIN,
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
    ],
    replied: [{ classification: "interview", company: "Halden Systems" }],
    sent: [
      {
        at: Date.UTC(2026, 10, 16, 23, 42),
        ats: "greenhouse",
        company: "Northwind Labs",
        location: "Toronto, ON",
        title: "Platform Engineer",
      },
    ],
    skipped: 3,
    subject: "Overture recap: 4 ready to approve, 2 need an answer",
    timeZone: "UTC",
    unblocked: 4,
    url: `${APP_ORIGIN}/ready`,
    ...overrides,
  });
}

test("the recap HTML states the run, what needs you and yesterday's sends and replies", () => {
  const html = recap();

  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain("Good morning.");
  expect(html).toContain("Overture filled in 4 applications this morning");
  expect(html).toContain("Nothing is sent until you approve.");
  expect(html).toContain("While you were away: 1 sent · 3 skipped · 2 need you");
  expect(html).toContain("Ready to approve · 4");
  expect(html).toContain("Needs you");
  expect(html).toContain("2 questions need an answer");
  expect(html).toContain("Answering them lets 4 applications go ahead.");
  expect(html).toContain("Sent yesterday · 1 application");
  expect(html).toContain("Between 08:00–20:00 your time.");
  expect(html).toContain("11:42 pm · via Greenhouse");
  expect(html).toContain("Interview request");
  expect(html).toContain("1 employer replied yesterday");
  expect(html).toContain("Review and send");
  expect(html).toContain("Opening this email or its link never sends anything.");
  expect(html).toContain("Overture · [POSTAL ADDRESS]");
});

test("the recap HTML lists three Ready applications and how many more wait", () => {
  const html = recap();

  expect(html).toContain("Platform Engineer");
  expect(html).toContain("Site Reliability Engineer");
  expect(html).toContain("Senior Backend Engineer");
  expect(html).not.toContain("Staff Engineer");
  expect(html).toContain("1 more is ready in Overture, with the answers and cover letter for it.");
});

test("the recap HTML carries one Ready link and no other action", () => {
  const html = recap();

  expect([...html.matchAll(/\/ready/gu)]).toHaveLength(1);
  expect([...html.matchAll(/\/settings/gu)]).toHaveLength(2);
});

test("the recap HTML keeps the design tokens and the dark palette", () => {
  const html = recap();

  expect(html).toContain("prefers-color-scheme: dark");
  expect(html).toContain("#F3EEE4");
  expect(html).toContain("#151311");
  expect(html).toContain("#221F1C");
  expect(html).not.toMatch(/\bzinc-/u);
});

test("the recap HTML never uses the words the product banned", () => {
  const html = recap();

  for (const word of ["Hold", "Job Board", "password", "SAMPLE DATA", "Fig ", "Folio"]) {
    expect(html).not.toContain(word);
  }
});

test("the recap HTML leaves yesterday out when the user turns it off", () => {
  const html = recap({ includeYesterday: false });

  expect(html).not.toContain("Sent yesterday");
  expect(html).not.toContain("replied yesterday");
  expect(html).not.toContain("While you were away");
  expect(html).toContain("Needs you");
  expect([...html.matchAll(/\/ready/gu)]).toHaveLength(1);
});

test("the recap HTML escapes employer and question text", () => {
  const html = recap({
    prompts: ["<script>alert(1)</script>"],
    ready: [
      {
        ats: "greenhouse",
        company: "A & B <Labs>",
        location: null,
        title: `"Engineer" 'Senior'`,
      },
    ],
    replied: [],
    sent: [],
    skipped: 0,
  });

  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("A &amp; B &lt;Labs&gt;");
  expect(html).toContain("&quot;Engineer&quot; &#39;Senior&#39;");
});

test("company initials take at most two words", () => {
  expect(companyInitials("Northwind Labs")).toBe("NL");
  expect(companyInitials("Overture")).toBe("O");
  expect(companyInitials("A & B Consulting Group")).toBe("AB");
  expect(companyInitials("  ")).toBe("·");
});

test("times and dates render in the user's zone", () => {
  expect(mailTime(Date.UTC(2026, 10, 17, 23, 42), "UTC")).toBe("11:42 pm");
  expect(mailTime(Date.UTC(2026, 10, 17, 0, 5), "UTC")).toBe("12:05 am");
  expect(mailDate(Date.UTC(2026, 10, 17, 12, 0), "UTC")).toBe("Tue 17 Nov 2026");
});
