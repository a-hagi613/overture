import { useCallback } from "react";
import { Link, useParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { loadBillingUser } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { BillingRow } from "./billing-row.tsx";
import { RefundForm } from "./refund-form.tsx";
import { billingPlanLabel, periodSpan } from "./billing-labels.ts";

export function BillingRefundPage() {
  const { id = "" } = useParams();
  const load = useCallback(async () => loadBillingUser(id), [id]);
  const { data, refusal, refresh } = useAdminResource(load);

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
  const period = user.current;
  const back = `/admin/billing/users/${encodeURIComponent(user.id)}`;

  if (period === null || !user.refundable) {
    return (
      <>
        <AdminPageHeading
          italic={copy.admin.billingRefundTitleItalic}
          lead={copy.admin.billingRefundLead}
          plain={copy.admin.billingRefundTitlePlain}
        />
        <p className="mt-5 text-[13px] text-muted-foreground">
          {copy.admin.billingUserNotRefundable}
        </p>
        <Link to={back} className="mt-3 inline-block underline">
          {copy.admin.billingRefundBack}
        </Link>
      </>
    );
  }

  return (
    <>
      <nav
        aria-label={copy.admin.billingUserCrumbRoot}
        className="mt-4 text-[13px] text-muted-foreground"
      >
        <Link to="/admin/billing" className="underline underline-offset-2">
          {copy.admin.billingUserCrumbRoot}
        </Link>
        {" / "}
        <Link to={back} className="underline underline-offset-2">
          {user.name}
        </Link>
      </nav>
      <AdminPageHeading
        italic={copy.admin.billingRefundTitleItalic}
        lead={copy.admin.billingRefundLead}
        plain={copy.admin.billingRefundTitlePlain}
      />
      <p className="mt-2 max-w-[62ch] text-[13px] text-muted-foreground">
        {copy.admin.billingRefundIntro}
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <section
          aria-labelledby="refund-payment"
          className="h-fit rounded-lg border border-border bg-card p-5 shadow-sh"
        >
          <h2 id="refund-payment" className="font-serif text-[22px] leading-tight">
            {copy.admin.billingUserPaymentHeading}
          </h2>
          <dl className="mt-3">
            <BillingRow label={copy.admin.billingUserUser} value={user.name} />
            <BillingRow label={copy.admin.billingUserPlan} value={billingPlanLabel(period.plan)} />
            <BillingRow label={copy.admin.billingUserPeriod} value={periodSpan(period)} />
            <BillingRow
              label={copy.admin.billingUserApplications}
              value={copy.admin.billingUsed(period.used, period.quantity)}
            />
          </dl>
        </section>

        <section
          aria-labelledby="refund-form"
          className="rounded-lg border border-border bg-card p-5 shadow-sh"
        >
          <h2 id="refund-form" className="font-serif text-[22px] leading-tight">
            {copy.admin.billingRefundTitlePlain} {copy.admin.billingRefundTitleItalic}
          </h2>
          <RefundForm period={period} userId={user.id} />
        </section>
      </div>
    </>
  );
}
