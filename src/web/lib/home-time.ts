import { copy } from "../../shared/copy.ts";

export function timeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(at));
}

export function sendTimeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(at));
}

export function dateKey(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: zone,
    year: "numeric",
  }).format(new Date(at));
}

export function stampText(at: number, now: number, zone: string) {
  if (dateKey(at, zone) === dateKey(now, zone)) {
    return timeText(at, zone);
  }

  const weekday = new Intl.DateTimeFormat(copy.home.dateLocale, {
    timeZone: zone,
    weekday: "short",
  }).format(new Date(at));

  return `${weekday} ${timeText(at, zone)}`;
}
