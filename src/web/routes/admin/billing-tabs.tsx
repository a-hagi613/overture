import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";

const TAB_BASE = "flex min-h-[44px] items-center rounded-md px-3 text-[13px]";
const TAB_CURRENT = `${TAB_BASE} bg-card font-medium text-foreground shadow-sh hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground`;
const TAB_LINK = `${TAB_BASE} text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground`;
const TAB_PENDING = `${TAB_BASE} text-muted-foreground`;

/**
 * The billing sections. Users, Reconciliation and Cost and margin are live;
 * Refunds is a plain label until its page ships, so no link leads nowhere.
 * @param props The section that is open.
 * @param props.current The section the page belongs to.
 * @returns The billing section navigation.
 */
export function BillingTabs({ current }: { current: "users" | "reconciliation" | "margin" }) {
  return (
    <nav
      aria-label={copy.admin.billingSections}
      className="mt-6 flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1"
    >
      {current === "users" ? (
        <Link aria-current="page" className={TAB_CURRENT} to="/admin/billing">
          {copy.admin.billingTabUsers}
        </Link>
      ) : (
        <Link className={TAB_LINK} to="/admin/billing">
          {copy.admin.billingTabUsers}
        </Link>
      )}
      <span aria-disabled="true" className={TAB_PENDING}>
        {copy.admin.billingTabRefunds}
      </span>
      {current === "reconciliation" ? (
        <Link aria-current="page" className={TAB_CURRENT} to="/admin/billing/reconciliation">
          {copy.admin.billingTabReconciliation}
        </Link>
      ) : (
        <Link className={TAB_LINK} to="/admin/billing/reconciliation">
          {copy.admin.billingTabReconciliation}
        </Link>
      )}
      {current === "margin" ? (
        <Link aria-current="page" className={TAB_CURRENT} to="/admin/billing/margin">
          {copy.admin.billingTabMargin}
        </Link>
      ) : (
        <Link className={TAB_LINK} to="/admin/billing/margin">
          {copy.admin.billingTabMargin}
        </Link>
      )}
    </nav>
  );
}
