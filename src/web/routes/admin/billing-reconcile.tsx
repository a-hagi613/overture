import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import type { BillingReconciliation } from "../../lib/admin-api.ts";

const tones = {
  clean: "bg-ok-soft text-ok",
  mismatch: "bg-card text-need",
} as const;

function summaryOf(reconciliation: BillingReconciliation) {
  if (reconciliation.status === "clean") {
    return copy.admin.billingReconcileClean(
      reconciliation.day,
      reconciliation.stripeInvoices,
      reconciliation.stripeRefunds,
    );
  }

  return copy.admin.billingReconcileMismatch(reconciliation.day, reconciliation.mismatchTotal);
}

export function BillingReconcile({
  reconciliation,
}: {
  reconciliation: BillingReconciliation | null;
}) {
  return (
    <section
      aria-labelledby="billing-reconcile"
      className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 shadow-sh ${reconciliation?.status === "mismatch" ? "border-need bg-need-soft" : "border-border bg-card"}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="billing-reconcile" className="text-sm font-semibold">
            {copy.admin.billingReconcileHeading}
          </h2>
          {reconciliation === null ? null : (
            <span
              className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${tones[reconciliation.status]}`}
            >
              {reconciliation.status === "clean"
                ? copy.admin.billingReconcileCleanPill
                : copy.admin.billingReconcileMismatchPill}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {reconciliation === null ? copy.admin.billingReconcileNone : summaryOf(reconciliation)}
        </p>
      </div>
      <Link
        to="/admin/billing/reconciliation"
        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold underline underline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9"
      >
        {copy.admin.billingReconcileOpen}
      </Link>
    </section>
  );
}
