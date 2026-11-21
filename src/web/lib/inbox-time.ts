import { copy } from "../../shared/copy.ts";
import { dateKey, timeText } from "./home-time.ts";

const DAY_MS = 24 * 60 * 60_000;

export function browserZone() {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function currentTime() {
  const now = new Date();

  return now.getTime();
}

function weekdayOf(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    timeZone: zone,
    weekday: "short",
  }).format(new Date(at));
}

function monthDayOf(at: number, zone: string) {
  const month = new Intl.DateTimeFormat(copy.home.dateLocale, {
    month: "short",
    timeZone: zone,
  }).format(new Date(at));

  const day = new Intl.DateTimeFormat(copy.home.dateLocale, {
    day: "numeric",
    timeZone: zone,
  }).format(new Date(at));

  return `${month} ${day}`;
}

export function threadStamp(at: number, now: number, zone: string) {
  if (dateKey(at, zone) === dateKey(now, zone)) {
    return `Today ${timeText(at, zone)}`;
  }

  if (dateKey(at, zone) === dateKey(now - DAY_MS, zone)) {
    return "Yesterday";
  }

  return `${weekdayOf(at, zone)} ${timeText(at, zone)}`;
}

export function messageStamp(at: number, now: number, zone: string) {
  if (dateKey(at, zone) === dateKey(now, zone)) {
    return `Today, ${timeText(at, zone)}`;
  }

  if (dateKey(at, zone) === dateKey(now - DAY_MS, zone)) {
    return `Yesterday, ${timeText(at, zone)}`;
  }

  return `${monthDayOf(at, zone)} · ${timeText(at, zone)}`;
}

export function dateLine() {
  const now = new Date();
  const weekday = now.toLocaleDateString(copy.home.dateLocale, { weekday: "long" });
  const month = now.toLocaleDateString(copy.home.dateLocale, { month: "long" });

  return `${weekday}, ${String(now.getDate())} ${month}`;
}
