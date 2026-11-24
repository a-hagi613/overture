import { useCallback, useState } from "react";
import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { loadBillingReconciliation } from "../../lib/admin-api.ts";
import type { BillingReconciliation } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminStatusCard } from "./admin-status-card.tsx";
import { BillingStatCard } from "./billing-stat-card.tsx";
import { BillingTabs } from "./billing-tabs.tsx";
import { ReconcileBanner } from "./billing-reconcile-banner.tsx";
import { ReconcilePayments } from "./billing-reconcile-payments.tsx";
import { billingLinkClass } from "./billing-labels.ts";
import { formatRunDay } from "./billing-reconcile-format.ts";

const PAYMENTS_ID = "billing-reconcile-payments";

const BUTTON_LINK = billingLinkClass;

interface ReconcileData {
  reconciliation: BillingReconciliation | null;
}

/**
 * The admin reconciliation page: the last daily check of Stripe payments
 * against Overture records, its verdict, four totals and the checked payments.
 * @returns The page.
 */
export function BillingReconciliationPage() {
  const [onlyMismatches, setOnlyMismatches] = useState(false);

  const load = useCallback(async () => {
    const result = await loadBillingReconciliation();

    if (!result.ok) {
      return { ok: false as const, refusal: result.refusal };
    }

    return { data: { reconciliation: result.data.reconciliation }, ok: true as const };
  }, []);

  const { data, failed, refusal, refresh } = useAdminResource<ReconcileData>(load, [
    "billing-reconciliation",
  ]);

  if (refusal !== null) {
    return <AdminGateScreen code={refusal} />;
  }

  if (data === null) {
    return <AdminStatusCard failed={failed} onRetry={refresh} />;
  }

  const { reconciliation } = data;

  const rows =
    reconciliation === null
      ? []
      : reconciliation.items.filter((item) => !onlyMismatches || item.result !== "matched");

  return (
    <>
      <nav
        aria-label={copy.admin.billingReconcileCrumbLabel}
        className="mt-4 text-sm text-muted-foreground"
      >
        <span>
          {copy.admin.billingReconcileCrumbAdmin}
          {copy.admin.billingReconcileCrumbSeparator}
        </span>
        <Link to="/admin/billing" className={billingLinkClass}>
          {copy.admin.billingUserCrumbRoot}
        </Link>
      </nav>

      <AdminPageHeading italic="" lead="" plain={copy.admin.billingReconcileTitlePlain} />
      <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
        {reconciliation === null
          ? copy.admin.billingReconcileLeadNone
          : copy.admin.billingReconcileLead(formatRunDay(reconciliation.day))}
      </p>

      <BillingTabs current="reconciliation" />

      <ReconcileBanner
        reconciliation={reconciliation}
        onReview={() => {
          setOnlyMismatches(true);
          document.querySelector(`#${PAYMENTS_ID}`)?.scrollIntoView({ block: "start" });
        }}
      />

      {reconciliation === null ? null : (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <BillingStatCard
            hint={copy.admin.billingReconcileStatCheckedHint}
            label={copy.admin.billingReconcileStatChecked}
            value={reconciliation.stripeInvoices}
          />
          <BillingStatCard
            hint={copy.admin.billingReconcileStatMatchedHint}
            label={copy.admin.billingReconcileStatMatched}
            value={reconciliation.matched}
          />
          <BillingStatCard
            hint={copy.admin.billingReconcileStatMismatchedHint}
            label={copy.admin.billingReconcileStatMismatched}
            value={reconciliation.mismatchTotal}
          />
          <BillingStatCard
            hint={copy.admin.billingReconcileStatOnlyStripeHint}
            label={copy.admin.billingReconcileStatOnlyStripe}
            value={reconciliation.unrecorded}
          />
        </div>
      )}

      {reconciliation === null ? null : (
        <section
          id={PAYMENTS_ID}
          aria-labelledby="billing-reconcile-payments-title"
          className="mt-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="billing-reconcile-payments-title" className="text-sm font-semibold">
              {copy.admin.billingReconcilePayments}
            </h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {copy.admin.billingReconcileShowing(rows.length, reconciliation.itemsTotal)}
            </p>
          </div>

          {onlyMismatches ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <p>{copy.admin.billingReconcileOnlyMismatches}</p>
              <button
                type="button"
                onClick={() => {
                  setOnlyMismatches(false);
                }}
                className={BUTTON_LINK}
              >
                {copy.admin.billingReconcileShowAll}
              </button>
            </div>
          ) : null}

          <div className="mt-3">
            {rows.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-sh">
                {onlyMismatches
                  ? copy.admin.billingReconcileEmptyFiltered
                  : copy.admin.billingReconcileEmptyList}
              </p>
            ) : (
              <ReconcilePayments items={rows} />
            )}
          </div>
        </section>
      )}
    </>
  );
}
