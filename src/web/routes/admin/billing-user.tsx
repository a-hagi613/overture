import { useCallback } from "react";
import { Link, useParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { loadBillingUser } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { BillingStatePill } from "./billing-format.tsx";
import { BillingRow } from "./billing-row.tsx";
import { billingPlanLabel, dayOf, periodSpan } from "./billing-labels.ts";

export function BillingUserPage() {
  const { id = "" } = useParams();
  const load = useCallback(async () => loadBillingUser(id), [id]);
  const { data, refusal, refresh } = useAdminResource(load, ["billing-user", id]);

  if (refusal !== null) {
    return (
      <AdminGateScreen
        code={refusal}
        onPasskeyDone={() => {
          refresh();
        }}
      />
    );
  }

  if (data === null) {
    return null;
  }

  const { user } = data;
  const { current } = user;

  const renewalLabel =
    current?.expiresAt === null || current === null
      ? copy.admin.billingUserRenews
      : copy.admin.billingUserExpires;

  return (
    <>
      <nav
        aria-label={copy.admin.billingUserCrumbRoot}
        className="mt-4 text-[13px] text-muted-foreground"
      >
        <Link to="/admin/billing" className="underline underline-offset-2">
          {copy.admin.billingUserCrumbRoot}
        </Link>
      </nav>
      <AdminPageHeading
        italic=""
        lead={user.name === user.email ? "" : user.email}
        plain={user.name.length > 0 ? user.name : copy.admin.billingUserNameFallback}
      />

      {user.paused ? (
        <output className="mt-5 block rounded-lg bg-need-soft px-4 py-3 text-[13px] text-need">
          {copy.admin.billingUserPausedNote}
        </output>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="billing-payment"
          className="rounded-lg border border-border bg-card p-5 shadow-sh"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="billing-payment" className="font-serif text-[22px] leading-tight">
              {copy.admin.billingUserPaymentHeading}
            </h2>
            <BillingStatePill state={user.state} />
          </div>
          {current === null ? (
            <p className="mt-3 text-[13px] text-muted-foreground">
              {copy.admin.billingUserPeriodEmpty}
            </p>
          ) : (
            <dl className="mt-3">
              <BillingRow
                label={copy.admin.billingUserPlan}
                value={billingPlanLabel(current.plan)}
              />
              <BillingRow label={copy.admin.billingUserPeriod} value={periodSpan(current)} />
              <BillingRow
                label={renewalLabel}
                value={
                  current.expiresAt === null ? copy.admin.billingNoPeriod : dayOf(current.expiresAt)
                }
              />
              <BillingRow
                label={copy.admin.billingUserApplications}
                value={copy.admin.billingUsed(current.used, current.quantity)}
              />
            </dl>
          )}
          {user.refundable ? (
            <Link
              to={`/admin/billing/users/${encodeURIComponent(user.id)}/refund`}
              className="mt-4 inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-[13px] font-semibold text-card hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9"
            >
              {copy.admin.billingUserRefundAction}
            </Link>
          ) : (
            <p className="mt-4 text-[13px] text-muted-foreground">
              {current?.refunded === true
                ? copy.admin.billingUserRefunded
                : copy.admin.billingUserNotRefundable}
            </p>
          )}
        </section>

        <section
          aria-labelledby="billing-trial"
          className="rounded-lg border border-border bg-card p-5 shadow-sh"
        >
          <h2 id="billing-trial" className="font-serif text-[22px] leading-tight">
            {copy.admin.billingUserTrialHeading}
          </h2>
          {user.trial === null ? (
            <p className="mt-3 text-[13px] text-muted-foreground">{copy.admin.billingNoPeriod}</p>
          ) : (
            <dl className="mt-3">
              <BillingRow label={copy.admin.billingUserPeriod} value={periodSpan(user.trial)} />
              <BillingRow
                label={copy.admin.billingUserApplications}
                value={copy.admin.billingUsed(user.trial.used, user.trial.quantity)}
              />
            </dl>
          )}
        </section>
      </div>

      <section
        aria-labelledby="billing-renewals"
        className="mt-4 rounded-lg border border-border bg-card p-5 shadow-sh"
      >
        <h2 id="billing-renewals" className="font-serif text-[22px] leading-tight">
          {copy.admin.billingUserPeriodsHeading}
        </h2>
        {user.periods.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">
            {copy.admin.billingUserPeriodEmpty}
          </p>
        ) : (
          <ul className="mt-3">
            {user.periods.map((period) => (
              <li
                key={period.grantId}
                className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border py-2.5 first:border-t-0"
              >
                <span className="text-[13px]">{periodSpan(period)}</span>
                <span className="text-[13px] text-muted-foreground">
                  {copy.admin.billingUsed(period.used, period.quantity)}
                  {period.refunded ? ` · ${copy.admin.billingUserRefunded}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
