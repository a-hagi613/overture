export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface LocalTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
  second: number;
}

const PARTS_FORMAT = {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  year: "numeric",
} as const;

export function localPartsAt(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...PARTS_FORMAT,
    timeZone,
  }).formatToParts(new Date(at));

  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    month: Number(values.get("month")),
    second: Number(values.get("second")),
    year: Number(values.get("year")),
  } satisfies LocalTimeParts;
}

export function localDateAt(at: number, timeZone: string) {
  const parts = localPartsAt(at, timeZone);

  return { day: parts.day, month: parts.month, year: parts.year } satisfies LocalDateParts;
}

export function addLocalDays(date: LocalDateParts, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));

  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  } satisfies LocalDateParts;
}

function offsetAt(at: number, timeZone: string) {
  const parts = localPartsAt(at, timeZone);

  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(at / 1000) * 1000
  );
}

export function zonedTimeToEpoch(
  date: LocalDateParts,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = offsetAt(guess, timeZone);
  const candidate = guess - first;
  const second = offsetAt(candidate, timeZone);

  return second === first ? candidate : guess - second;
}

export function localDayStartFor(date: LocalDateParts, timeZone: string) {
  return zonedTimeToEpoch(date, 0, 0, timeZone);
}

export function localDayStart(at: number, timeZone: string) {
  return localDayStartFor(localDateAt(at, timeZone), timeZone);
}

export function nextLocalDayStart(at: number, timeZone: string) {
  return localDayStartFor(addLocalDays(localDateAt(at, timeZone), 1), timeZone);
}

export function localTimeOn(date: LocalDateParts, hour: number, minute: number, timeZone: string) {
  return zonedTimeToEpoch(date, hour, minute, timeZone);
}

export function localWindowOn(
  date: LocalDateParts,
  startMinutes: number,
  endMinutes: number,
  timeZone: string,
) {
  const start = localTimeOn(date, Math.trunc(startMinutes / 60), startMinutes % 60, timeZone);

  const end =
    endMinutes >= 24 * 60
      ? localTimeOn(addLocalDays(date, 1), 0, 0, timeZone)
      : localTimeOn(date, Math.trunc(endMinutes / 60), endMinutes % 60, timeZone);

  return { end, start };
}
