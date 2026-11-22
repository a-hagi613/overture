import { copy } from "../../../shared/copy.ts";
import type { BillingReconciliation } from "../../lib/admin-api.ts";
import { formatRunDay } from "./billing-reconcile-format.ts";
import { ReconcileIcon } from "./billing-reconcile-icon.tsx";

const BUTTON =
  "inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-[13px] font-semibold text-card hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

export function ReconcileBanner({
  reconciliation,
  onReview,
}: {
  reconciliation: BillingReconciliation | null;
  onReview: () => void;
}) {
  if (reconciliation === null) {
    return (
      <section
        aria-labelledby="reconcile-banner-title"
        className="mt-5 flex gap-3 rounded-lg border border-border bg-card p-4 shadow-sh"
      >
        <ReconcileIcon kind="info" />
        <div>
          <h2 id="reconcile-banner-title" className="text-[14px] font-semibold">
            {copy.admin.billingReconcileBannerNoneTitle}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {copy.admin.billingReconcileNone}
          </p>
        </div>
      </section>
    );
  }

  if (reconciliation.status === "clean") {
    return (
      <section
        aria-labelledby="reconcile-banner-title"
        className="mt-5 flex gap-3 rounded-lg border border-border bg-card p-4 shadow-sh"
      >
        <span className="text-ok">
          <ReconcileIcon kind="check" />
        </span>
        <div>
          <h2 id="reconcile-banner-title" className="text-[14px] font-semibold">
            {copy.admin.billingReconcileBannerCleanTitle(formatRunDay(reconciliation.day))}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {copy.admin.billingReconcileBannerCleanBody(
              reconciliation.stripeInvoices,
              reconciliation.stripeRefunds,
            )}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="reconcile-banner-title"
      className="mt-5 flex gap-3 rounded-lg border border-need bg-need-soft p-4 text-need shadow-sh"
    >
      <ReconcileIcon kind="warning" />
      <div className="min-w-0">
        <h2 id="reconcile-banner-title" className="text-[14px] font-semibold">
          {copy.admin.billingReconcileBannerMismatchTitle(reconciliation.mismatchTotal)}
        </h2>
        <p className="mt-1 text-[13px] text-foreground">
          {copy.admin.billingReconcileBannerMismatchBody}
        </p>
        <button type="button" onClick={onReview} className={`${BUTTON} mt-3`}>
          {copy.admin.billingReconcileReview(reconciliation.mismatchTotal)}
        </button>
      </div>
    </section>
  );
}
