import { zonedTimeToEpoch } from "../platform/local-time.ts";

export interface ParsedInterviewEvent {
  cancelled: boolean;
  endsAt: number | null;
  sequence: number;
  startsAt: number | null;
  tz: string | null;
  uid: string;
}

interface CalendarProperty {
  name: string;
  params: ReadonlyMap<string, string>;
  value: string;
}

interface CalendarInstant {
  at: number;
  tz: string | null;
}

const DATE_PATTERN =
  /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})(?:T(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})(?<utc>Z)?)?$/u;

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function unquote(value: string) {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function splitOutsideQuotes(text: string, separator: string) {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      quoted = !quoted;
    } else if (char === separator && !quoted) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));

  return parts;
}

function colonIndex(line: string) {
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      quoted = !quoted;
    } else if (char === ":" && !quoted) {
      return index;
    }
  }

  return -1;
}

function propertyOf(line: string) {
  const colon = colonIndex(line);

  if (colon <= 0) {
    return null;
  }

  const [rawName, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ";");

  if (rawName === undefined) {
    return null;
  }

  const params = new Map<string, string>();

  for (const raw of rawParams) {
    const equals = raw.indexOf("=");

    if (equals > 0) {
      params.set(raw.slice(0, equals).toUpperCase(), unquote(raw.slice(equals + 1)));
    }
  }

  return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1).trim() };
}

function unfold(text: string) {
  return text.replaceAll(/\r?\n[ \t]/gu, "").split(/\r?\n/u);
}

function knownTimeZone(value: string | undefined) {
  const zone = value?.trim() ?? "";

  if (zone === "") {
    return null;
  }

  if (zoneFormatters.has(zone)) {
    return zone;
  }

  if (zoneFormatters.size >= 64) {
    zoneFormatters.clear();
  }

  try {
    zoneFormatters.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone }));

    return zone;
  } catch {
    return null;
  }
}

/**
 * Falls back to UTC when a stored zone is empty or not an IANA name, so one bad profile value cannot stop the parser.
 * @param value The zone to check, usually `profiles.timezone`.
 * @returns The zone when `Intl` accepts it, else `UTC`.
 */
export function usableTimeZone(value: string | null) {
  return knownTimeZone(value ?? undefined) ?? "UTC";
}

function instantOf(property: CalendarProperty | undefined, fallbackTimeZone: string) {
  if (property === undefined) {
    return null;
  }

  const groups = DATE_PATTERN.exec(property.value)?.groups;

  if (groups === undefined) {
    return null;
  }

  const year = Number(groups["year"]);
  const month = Number(groups["month"]);
  const day = Number(groups["day"]);
  const hour = groups["hour"] === undefined ? 0 : Number(groups["hour"]);
  const minute = groups["minute"] === undefined ? 0 : Number(groups["minute"]);
  const second = groups["second"] === undefined ? 0 : Number(groups["second"]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const tz = knownTimeZone(property.params.get("TZID"));

  if (groups["utc"] === "Z") {
    return {
      at: Date.UTC(year, month - 1, day, hour, minute, second),
      tz,
    } satisfies CalendarInstant;
  }

  const at =
    zonedTimeToEpoch({ day, month, year }, hour, minute, tz ?? fallbackTimeZone) + second * 1000;

  return { at, tz } satisfies CalendarInstant;
}

function sequenceOf(value: string | undefined) {
  const parsed = Math.trunc(Number(value?.trim() ?? ""));

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function eventOf(
  properties: readonly CalendarProperty[],
  method: string,
  fallbackTimeZone: string,
) {
  const byName = new Map(properties.map((property) => [property.name, property]));
  const uid = byName.get("UID")?.value.trim() ?? "";

  if (uid === "") {
    return null;
  }

  const status = byName.get("STATUS")?.value.trim().toUpperCase() ?? "";
  const cancelled = method === "CANCEL" || status === "CANCELLED";
  const start = instantOf(byName.get("DTSTART"), fallbackTimeZone);

  if (!cancelled && start === null) {
    return null;
  }

  const end = instantOf(byName.get("DTEND"), fallbackTimeZone);

  return {
    cancelled,
    endsAt: start !== null && end !== null && end.at > start.at ? end.at : null,
    sequence: sequenceOf(byName.get("SEQUENCE")?.value),
    startsAt: start?.at ?? null,
    tz: start?.tz ?? null,
    uid,
  } satisfies ParsedInterviewEvent;
}

/**
 * Reads the interview invitations out of a `text/calendar` attachment. Only RFC 5545 `VEVENT` properties are trusted:
 * `UID`, `SEQUENCE`, `DTSTART`, `DTEND`, `TZID`, `METHOD:CANCEL` and `STATUS:CANCELLED`. Text in the mail body is never
 * parsed, because a wrong date is worse than no date.
 * @param text The attachment's bytes as UTF-8.
 * @param fallbackTimeZone The user's zone, used for a floating time with no `Z` and no `TZID`.
 * @returns One entry per `VEVENT`; a cancelled event may carry no start because only its `UID` matters.
 */
export function parseInterviewCalendar(text: string, fallbackTimeZone: string) {
  const events: ParsedInterviewEvent[] = [];
  let method = "";
  let current: CalendarProperty[] | null = null;

  for (const line of unfold(text)) {
    const property = propertyOf(line);

    if (property === null) {
      continue;
    }

    if (property.name === "BEGIN" && property.value.toUpperCase() === "VEVENT") {
      current = [];
      continue;
    }

    if (property.name === "END" && property.value.toUpperCase() === "VEVENT") {
      if (current !== null) {
        const event = eventOf(current, method, fallbackTimeZone);

        if (event !== null) {
          events.push(event);
        }
      }

      current = null;
      continue;
    }

    if (current !== null) {
      current.push(property);
    } else if (property.name === "METHOD") {
      method = property.value.toUpperCase();
    }
  }

  return events;
}
