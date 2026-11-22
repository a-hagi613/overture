const money = new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" });

/**
 * A Stripe amount in cents, as dollars.
 * @param cents The amount in cents, or null when Stripe reported none.
 * @returns The formatted amount, or an empty string for null.
 */
export function formatCents(cents: number | null) {
  return cents === null ? "" : money.format(cents / 100);
}

/**
 * A stored UTC day as the short form the board shows, such as "20 Nov".
 * @param day The day as YYYY-MM-DD.
 * @returns The short day.
 */
export function formatRunDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * A payment id shortened for the list, keeping the prefix and the last four
 * characters, as the board does.
 * @param id The Stripe invoice id.
 * @returns The shortened id.
 */
export function shortPaymentId(id: string) {
  return id.length <= 12 ? id : `${id.slice(0, 7)}…${id.slice(-4)}`;
}
