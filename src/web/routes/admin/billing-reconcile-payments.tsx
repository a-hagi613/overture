import { copy } from "../../../shared/copy.ts";
import type { BillingReconciliationItem } from "../../lib/admin-api.ts";
import { formatCents, shortPaymentId } from "./billing-reconcile-format.ts";
import { ResultPill } from "./billing-result-pill.tsx";

function ownerLabel(item: BillingReconciliationItem) {
  if (item.owner === null) {
    return copy.admin.billingReconcileNoOwner;
  }

  return item.owner.name.length > 0 ? item.owner.name : item.owner.email;
}

function stripeLabel(item: BillingReconciliationItem) {
  return item.result === "not_in_stripe"
    ? copy.admin.billingReconcileNotInStripe
    : formatCents(item.amountCents);
}

function overtureLabel(item: BillingReconciliationItem) {
  return item.result === "not_in_overture"
    ? copy.admin.billingReconcileNotRecorded
    : copy.admin.billingReconcileRecorded;
}

export function ReconcilePayments({ items }: { items: readonly BillingReconciliationItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow-sh md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingReconcileColumnPayment}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingReconcileColumnUser}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingReconcileColumnStripe}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingReconcileColumnOverture}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingReconcileColumnResult}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-border hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs" title={item.id}>
                  {shortPaymentId(item.id)}
                </td>
                <td className="px-4 py-3">{ownerLabel(item)}</td>
                <td className="px-4 py-3 tabular-nums">{stripeLabel(item)}</td>
                <td className="px-4 py-3">{overtureLabel(item)}</td>
                <td className="px-4 py-3">
                  <ResultPill result={item.result} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-border bg-card p-4 shadow-sh">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-xs" title={item.id}>
                {shortPaymentId(item.id)}
              </p>
              <ResultPill result={item.result} />
            </div>
            <p className="mt-2 text-sm">{ownerLabel(item)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {`${copy.admin.billingReconcileColumnStripe}: ${stripeLabel(item)} · ${copy.admin.billingReconcileColumnOverture}: ${overtureLabel(item)}`}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
