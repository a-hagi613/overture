import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";

/**
 * The billing sections. Only cost and margin is built; the other three are
 * shown as plain labels until their pages ship, so no link leads nowhere.
 * @returns The billing section navigation.
 */
export function BillingTabs() {
  return (
    <nav
      aria-label={copy.admin.billingSections}
      className="mt-6 flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1"
    >
      <span
        aria-disabled="true"
        className="flex min-h-[44px] items-center rounded-md px-3 text-[13px] text-muted-foreground"
      >
        {copy.admin.billingTabUsers}
      </span>
      <span
        aria-disabled="true"
        className="flex min-h-[44px] items-center rounded-md px-3 text-[13px] text-muted-foreground"
      >
        {copy.admin.billingTabRefunds}
      </span>
      <span
        aria-disabled="true"
        className="flex min-h-[44px] items-center rounded-md px-3 text-[13px] text-muted-foreground"
      >
        {copy.admin.billingTabReconciliation}
      </span>
      <Link
        aria-current="page"
        className="flex min-h-[44px] items-center rounded-md bg-card px-3 text-[13px] font-medium text-foreground shadow-sh hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        to="/admin/billing/margin"
      >
        {copy.admin.billingTabMargin}
      </Link>
    </nav>
  );
}
