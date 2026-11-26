import type { BillingState } from "../lib/billing-api.ts";

import { copy } from "../../shared/copy.ts";
import { dayText } from "../lib/billing-format.ts";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow, dsMono } from "./ui/ds.ts";

export function BillingBalanceCard(props: { balance: BillingState["balance"] }) {
  const bp = copy.settingsBilling;
  const { balance } = props;

  const expiring =
    balance.expiring === null
      ? bp.balanceNoneExpiring
      : bp.balanceExpiringValue(balance.expiring.applications, dayText(balance.expiring.expiresAt));

  const rows = [
    {
      label: bp.balanceTrial,
      value: bp.balanceAllowance(balance.trial.granted, balance.trial.used, balance.trial.left),
    },
    {
      label: bp.balancePaid,
      value: bp.balanceAllowance(balance.paid.granted, balance.paid.used, balance.paid.left),
    },
    { label: bp.balanceHeld, value: String(balance.reserved) },
    { label: bp.balanceUsed, value: String(balance.used) },
    { label: bp.balanceReturned, value: String(balance.released) },
    { label: bp.balanceExpiring, value: expiring },
  ];

  return (
    <Card ariaLabelledBy="billing-balance-heading" className="p-5 md:p-6">
      <p className={dsEyebrow}>{bp.balanceHeading}</p>
      <h2 className={`${dsCardTitle} mt-1.5`} id="billing-balance-heading">
        {bp.balanceTitle}
      </h2>
      <p className={`${dsBody} mt-1.5 max-w-2xl`}>{bp.balanceHint}</p>
      <dl className="mt-4 divide-y divide-border border-t border-border">
        {rows.map((row) => (
          <div
            className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
            key={row.label}
          >
            <dt className="text-sm text-foreground">{row.label}</dt>
            <dd className={`${dsMono} text-foreground sm:text-right`}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
