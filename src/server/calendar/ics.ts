/**
 * An RFC 5545 writer for the read-only calendar feed (ADR 0034, M4). It writes only what a subscribing calendar app
 * needs: a stable UID, DTSTAMP, DTSTART (and DTEND for all-day events) and a one-line SUMMARY. Lines are CRLF
 * terminated and folded at 75 octets, and a folded line never splits a UTF-8 character.
 */

export type IcsStart =
  | { kind: "date"; year: number; month: number; day: number }
  | { kind: "datetime"; at: number };

export interface IcsEvent {
  uid: string;
  stampAt: number;
  start: IcsStart;
  summary: string;
}

const LINE_OCTETS = 75;

const encoder = new TextEncoder();

/**
 * Escapes a TEXT value (RFC 5545 §3.3.11): backslash, semicolon, comma and line breaks.
 * @param value The raw text.
 * @returns The escaped text, safe on one logical line.
 */
export function escapeIcsText(value: string) {
  return value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll(";", String.raw`\;`)
    .replaceAll(",", String.raw`\,`)
    .replaceAll(/\r\n|\r|\n/gu, String.raw`\n`);
}

/**
 * Folds one content line to 75 octets; continuation lines start with a single space (RFC 5545 §3.1).
 * @param line One unfolded content line.
 * @returns The folded lines joined with CRLF.
 */
export function foldIcsLine(line: string) {
  const parts: string[] = [];
  let current = "";
  let used = 0;
  let limit = LINE_OCTETS;

  for (const character of line) {
    const size = encoder.encode(character).byteLength;

    if (used + size > limit) {
      parts.push(current);
      current = "";
      used = 0;
      limit = LINE_OCTETS - 1;
    }

    current += character;
    used += size;
  }

  parts.push(current);

  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

function pad(value: number, width: number) {
  return String(value).padStart(width, "0");
}

function dateValue(year: number, month: number, day: number) {
  return `${pad(year, 4)}${pad(month, 2)}${pad(day, 2)}`;
}

function dateTimeValue(at: number) {
  return new Date(at)
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replaceAll(/[-:]/gu, "");
}

function eventLines(event: IcsEvent) {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${dateTimeValue(event.stampAt)}`,
  ];

  if (event.start.kind === "date") {
    const { year, month, day } = event.start;
    const next = new Date(Date.UTC(year, month - 1, day + 1));

    lines.push(
      `DTSTART;VALUE=DATE:${dateValue(year, month, day)}`,
      `DTEND;VALUE=DATE:${dateValue(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())}`,
    );
  } else {
    lines.push(`DTSTART:${dateTimeValue(event.start.at)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(event.summary)}`, "TRANSP:TRANSPARENT", "END:VEVENT");

  return lines;
}

/**
 * Writes a whole VCALENDAR document.
 * @param events The events, already reduced to the minimal fields the feed exposes.
 * @param name The calendar name shown by subscribing apps.
 * @returns The calendar text, CRLF line endings, folded lines.
 */
export function renderIcsCalendar(events: readonly IcsEvent[], name = "Overture") {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Overture//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    ...events.flatMap((event) => eventLines(event)),
    "END:VCALENDAR",
  ];

  return `${lines.map((line) => foldIcsLine(line)).join("\r\n")}\r\n`;
}
