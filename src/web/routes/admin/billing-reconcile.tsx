import { copy } from "../../../shared/copy.ts";
import type { BillingReconciliation } from "../../lib/admin-api.ts";

const tones = {
  clean: "bg-ok-soft text-ok",
  mismatch: "bg-need-soft text-need",
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
      className="mt-4 rounded-lg border border-border bg-card p-4 shadow-sh"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="billing-reconcile" className="text-[13px] font-semibold">
          {copy.admin.billingReconcileHeading}
        </h2>
        {reconciliation === null ? null : (
          <span
            className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${tones[reconciliation.status]}`}
          >
            {reconciliation.status === "clean"
              ? copy.admin.billingReconcileCleanPill
              : copy.admin.billingReconcileMismatchPill}
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {reconciliation === null ? copy.admin.billingReconcileNone : summaryOf(reconciliation)}
      </p>
      {reconciliation === null || reconciliation.mismatches.length === 0 ? null : (
        <>
          <ul className="mt-2 space-y-1 text-[13px]">
            {reconciliation.mismatches.map((mismatch) => (
              <li key={`${mismatch.kind}:${mismatch.id}`}>
                {copy.admin.billingReconcileItem(
                  copy.admin.billingReconcileKinds[mismatch.kind],
                  mismatch.id,
                )}
              </li>
            ))}
          </ul>
          {reconciliation.mismatches.length < reconciliation.mismatchTotal ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {copy.admin.billingReconcileMore(
                reconciliation.mismatches.length,
                reconciliation.mismatchTotal,
              )}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
