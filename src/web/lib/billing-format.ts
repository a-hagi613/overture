/**
 * A short day and time, such as "Sun 28 Nov, 08:12".
 * @param at The instant in epoch milliseconds.
 * @returns The formatted day and time.
 */
export function renewalText(at: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    weekday: "short",
  }).format(new Date(at));
}

/**
 * A short day and month, such as "Sat 28 Dec".
 * @param at The instant in epoch milliseconds.
 * @returns The formatted day and month.
 */
export function dayText(at: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(new Date(at));
}
