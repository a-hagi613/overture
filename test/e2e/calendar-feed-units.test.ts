import { expect, test } from "@playwright/test";

import { escapeIcsText, foldIcsLine, renderIcsCalendar } from "../../src/server/calendar/ics.ts";
import { migrateDatabase } from "../../src/server/platform/db/migrate.ts";
import { openDatabase } from "../../src/server/platform/db/client.ts";
import { calendarFeedTokens, users } from "../../src/server/platform/db/schema.ts";

import {
  feedStatusOf,
  feedTokenHash,
  isPlausibleFeedToken,
  issueFeedToken,
  newFeedToken,
  revokeFeedToken,
  userIdForFeedToken,
} from "../../src/server/calendar/feed.ts";

const T0 = Date.UTC(2026, 10, 21, 9, 0, 0);

function freshFeed() {
  let nowMs = T0;
  const clock = { now: () => nowMs };
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const at = new Date(T0);

  db.insert(users)
    .values({
      createdAt: at,
      email: "owner@example.com",
      emailVerified: true,
      id: "user-1",
      name: "Owner",
      role: "owner",
      updatedAt: at,
    })
    .run();

  return {
    advance(ms: number) {
      nowMs += ms;
    },
    clock,
    db,
    close: () => sqlite.close(),
  };
}

test.describe("feed tokens", () => {
  test("a token is 43 base64url characters and every new token differs", () => {
    const first = newFeedToken();
    const second = newFeedToken();

    expect(isPlausibleFeedToken(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  test("the stored hash is a SHA-256 hex digest that is not the token", () => {
    const token = newFeedToken();
    const hash = feedTokenHash(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(hash).not.toContain(token);
    expect(feedTokenHash(token)).toBe(hash);
  });

  test("a malformed value is refused before any lookup", () => {
    expect(isPlausibleFeedToken("short")).toBe(false);
    expect(isPlausibleFeedToken(`${"a".repeat(43)}.`)).toBe(false);
    expect(isPlausibleFeedToken("")).toBe(false);
  });
});

test.describe("issuing, rotating and revoking the calendar feed", () => {
  test("the database holds only the hash, never the plaintext token", () => {
    const feed = freshFeed();

    try {
      const { token } = issueFeedToken(feed.db, feed.clock, "user-1");
      const rows = feed.db.select().from(calendarFeedTokens).all();

      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(rows[0]?.tokenHash).toBe(feedTokenHash(token));
    } finally {
      feed.close();
    }
  });

  test("an issued token resolves to its owner, and an unknown one does not", () => {
    const feed = freshFeed();

    try {
      const { token } = issueFeedToken(feed.db, feed.clock, "user-1");

      expect(userIdForFeedToken(feed.db, token)).toBe("user-1");
      expect(userIdForFeedToken(feed.db, newFeedToken())).toBeNull();
      expect(userIdForFeedToken(feed.db, "not-a-token")).toBeNull();
    } finally {
      feed.close();
    }
  });

  test("rotating replaces the hash, so the previous token stops working at once", () => {
    const feed = freshFeed();

    try {
      const issued = issueFeedToken(feed.db, feed.clock, "user-1");
      feed.advance(60_000);
      const rotated = issueFeedToken(feed.db, feed.clock, "user-1");

      expect(rotated.token).not.toBe(issued.token);
      expect(userIdForFeedToken(feed.db, issued.token)).toBeNull();
      expect(userIdForFeedToken(feed.db, rotated.token)).toBe("user-1");
      expect(feed.db.select().from(calendarFeedTokens).all()).toHaveLength(1);
    } finally {
      feed.close();
    }
  });

  test("rotating keeps the original creation time and moves the rotation time", () => {
    const feed = freshFeed();

    try {
      issueFeedToken(feed.db, feed.clock, "user-1");
      feed.advance(60_000);
      issueFeedToken(feed.db, feed.clock, "user-1");

      expect(feedStatusOf(feed.db, "user-1")).toEqual({
        createdAt: T0,
        enabled: true,
        rotatedAt: T0 + 60_000,
      });
    } finally {
      feed.close();
    }
  });

  test("revoking turns the feed off and the old token stops resolving", () => {
    const feed = freshFeed();

    try {
      const { token } = issueFeedToken(feed.db, feed.clock, "user-1");
      revokeFeedToken(feed.db, "user-1");

      expect(userIdForFeedToken(feed.db, token)).toBeNull();
      expect(feedStatusOf(feed.db, "user-1")).toEqual({
        createdAt: null,
        enabled: false,
        rotatedAt: null,
      });
    } finally {
      feed.close();
    }
  });

  test("status never includes the token", () => {
    const feed = freshFeed();

    try {
      const { token } = issueFeedToken(feed.db, feed.clock, "user-1");

      expect(JSON.stringify(feedStatusOf(feed.db, "user-1"))).not.toContain(token);
    } finally {
      feed.close();
    }
  });
});

const STAMP = Date.UTC(2026, 10, 21, 9, 30, 0);

function unfold(text: string) {
  return text.replaceAll("\r\n ", "");
}

test.describe("escapeIcsText", () => {
  test("escapes backslash, semicolon, comma and line breaks, backslash first", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf\rg")).toBe(String.raw`a\\b\;c\,d\ne\nf\ng`);
  });

  test("leaves ordinary text and non-ASCII characters alone", () => {
    expect(escapeIcsText("Senior Engineer at Café Ltd")).toBe("Senior Engineer at Café Ltd");
  });
});

test.describe("foldIcsLine", () => {
  test("keeps a short line unchanged", () => {
    expect(foldIcsLine("SUMMARY:Applied")).toBe("SUMMARY:Applied");
  });

  test("folds at 75 octets with a leading space on each continuation line", () => {
    const line = `SUMMARY:${"x".repeat(200)}`;
    const folded = foldIcsLine(line).split("\r\n");

    expect(folded[0]?.length).toBe(75);

    for (const part of folded.slice(1)) {
      expect(part.startsWith(" ")).toBe(true);
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    }

    expect(unfold(foldIcsLine(line))).toBe(line);
  });

  test("never splits a multi-byte character across lines", () => {
    const line = `SUMMARY:${"é".repeat(120)}`;
    const folded = foldIcsLine(line).split("\r\n");

    for (const part of folded) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
      expect(part).not.toContain("�");
    }

    expect(unfold(foldIcsLine(line))).toBe(line);
  });
});

test.describe("renderIcsCalendar", () => {
  test("writes an empty calendar with CRLF line endings and no bare LF", () => {
    const text = renderIcsCalendar([]);

    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "")).not.toContain("\n");
    expect(text).not.toContain("VEVENT");
  });

  test("writes an all-day event as a DATE with an exclusive DTEND on the next day", () => {
    const text = renderIcsCalendar([
      {
        uid: "stage:evt-1@overture",
        stampAt: STAMP,
        start: { kind: "date", year: 2026, month: 11, day: 18 },
        summary: "Interviewing: Engineer at Acme",
      },
    ]);

    expect(text).toContain("BEGIN:VEVENT\r\n");
    expect(text).toContain("UID:stage:evt-1@overture\r\n");
    expect(text).toContain("DTSTAMP:20261121T093000Z\r\n");
    expect(text).toContain("DTSTART;VALUE=DATE:20261118\r\n");
    expect(text).toContain("DTEND;VALUE=DATE:20261119\r\n");
    expect(text).toContain("SUMMARY:Interviewing: Engineer at Acme\r\n");
    expect(text).toContain("END:VEVENT\r\n");
  });

  test("rolls DTEND over the end of a month and a year", () => {
    const text = renderIcsCalendar([
      {
        uid: "a",
        stampAt: STAMP,
        start: { kind: "date", year: 2026, month: 11, day: 30 },
        summary: "Sent: A at B",
      },
      {
        uid: "b",
        stampAt: STAMP,
        start: { kind: "date", year: 2026, month: 12, day: 31 },
        summary: "Sent: C at D",
      },
    ]);

    expect(text).toContain("DTEND;VALUE=DATE:20261201\r\n");
    expect(text).toContain("DTEND;VALUE=DATE:20270101\r\n");
  });

  test("writes a timed interview in UTC with DTSTART only", () => {
    const text = renderIcsCalendar([
      {
        uid: "interview:evt-2@overture",
        stampAt: STAMP,
        start: { kind: "datetime", at: Date.UTC(2026, 10, 24, 15, 0, 0) },
        summary: "Interview: Engineer at Acme",
      },
    ]);

    expect(text).toContain("DTSTART:20261124T150000Z\r\n");
    expect(text).not.toContain("DTEND");
  });

  test("escapes the summary so a comma or semicolon in a job title cannot add a property", () => {
    const text = renderIcsCalendar([
      {
        uid: "x",
        stampAt: STAMP,
        start: { kind: "date", year: 2026, month: 11, day: 1 },
        summary: "Sent: Engineer, Platform; SRE at Acme\nDESCRIPTION:leak",
      },
    ]);

    expect(text).toContain(
      "SUMMARY:Sent: Engineer\\, Platform\\; SRE at Acme\\nDESCRIPTION:leak\r\n",
    );
    expect(text).not.toMatch(/^DESCRIPTION/mu);
  });

  test("writes no description, attendee, URL or location property", () => {
    const text = renderIcsCalendar([
      {
        uid: "x",
        stampAt: STAMP,
        start: { kind: "date", year: 2026, month: 11, day: 1 },
        summary: "Sent: A at B",
      },
    ]);

    for (const name of ["DESCRIPTION", "ATTENDEE", "URL", "LOCATION", "ORGANIZER"]) {
      expect(text).not.toContain(`${name}:`);
    }
  });
});
