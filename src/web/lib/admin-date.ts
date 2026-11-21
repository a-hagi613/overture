import { copy } from "../../shared/copy.ts";

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
});

export function adminDay(at: number) {
  return dayFormat.format(new Date(at));
}

export function adminDayTime(at: number, now: number) {
  const time = timeFormat.format(new Date(at));

  return new Date(at).toDateString() === new Date(now).toDateString()
    ? copy.admin.todayAt(time)
    : copy.admin.dateAt(adminDay(at), time);
}

export function passkeyAgeText(at: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));

  if (minutes < 1) {
    return copy.admin.passkeyJustNow;
  }

  return minutes === 1 ? copy.admin.passkeyMinute(1) : copy.admin.passkeyMinutes(minutes);
}
