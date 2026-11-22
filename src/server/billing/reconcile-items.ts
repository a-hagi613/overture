import { z } from "zod";

/** How many checked payments one day's stored detail keeps; the totals always count them all. */
export const MAX_STORED_ITEMS = 100;

export const RECONCILE_ITEM_RESULTS = ["matched", "not_in_overture", "not_in_stripe"] as const;

export type ReconcileItemResult = (typeof RECONCILE_ITEM_RESULTS)[number];

/** One payment the day's check looked at, from either side of the comparison. */
export interface ReconcileItem {
  /** The Stripe invoice id; for a grant Stripe did not report, the invoice id it was granted for. */
  id: string;
  amountCents: number | null;
  /** The user the Overture grant belongs to, or null when no grant exists. */
  userId: string | null;
  result: ReconcileItemResult;
}

export const reconcileItemSchema = z.object({
  amountCents: z.number().nullable(),
  id: z.string(),
  result: z.enum(RECONCILE_ITEM_RESULTS),
  userId: z.string().nullable(),
});

/**
 * Lines the day's paid invoices up against the grants Overture recorded for
 * them, and lists the grants whose invoice Stripe did not report. Only the
 * first {@link MAX_STORED_ITEMS} items are kept; the counts cover all of them.
 * @param input The paid invoices, the grants keyed by invoice id, and the grants with no reported invoice.
 * @returns The stored items with their totals.
 */
export function reconciliationItems(input: {
  grantsByInvoice: ReadonlyMap<string, { userId: string }>;
  invoices: readonly { invoiceId: string; amountPaidCents: number }[];
  unmatchedGrants: readonly { invoiceId: string; userId: string }[];
}) {
  const all = [
    ...input.invoices.map((invoice) => {
      const grant = input.grantsByInvoice.get(invoice.invoiceId);

      return {
        amountCents: invoice.amountPaidCents,
        id: invoice.invoiceId,
        result: grant === undefined ? "not_in_overture" : "matched",
        userId: grant?.userId ?? null,
      } satisfies ReconcileItem;
    }),
    ...input.unmatchedGrants.map(
      (grant) =>
        ({
          amountCents: null,
          id: grant.invoiceId,
          result: "not_in_stripe",
          userId: grant.userId,
        }) satisfies ReconcileItem,
    ),
  ].toSorted((left, right) => left.id.localeCompare(right.id));

  return {
    items: all.slice(0, MAX_STORED_ITEMS),
    itemsTotal: all.length,
    matched: all.filter((item) => item.result === "matched").length,
    unrecorded: all.filter((item) => item.result === "not_in_overture").length,
  };
}
