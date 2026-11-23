import { copy } from "../../../shared/copy.ts";
import { loadMargin } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminStatusCard } from "./admin-status-card.tsx";
import { BesideCard } from "./beside-card.tsx";
import { BillingTabs } from "./billing-tabs.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { PlanCards } from "./plan-cards.tsx";
import { PlanTable } from "./plan-table.tsx";

export function MarginPage() {
  const { data, failed, refusal, refresh } = useAdminResource(loadMargin, undefined, {
    resourceId: "margin",
  });

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

  const header = (
    <>
      <p className="mt-6 text-[12.5px] text-muted-foreground">{copy.admin.billingCrumb}</p>
      <p className="mt-4 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {copy.admin.marginEyebrow}
      </p>
      <h1 className="mt-1 font-serif text-[40px] leading-[1.05] lg:text-[52px]">
        {copy.admin.marginTitle}
      </h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{copy.admin.marginLead}</p>

      <BillingTabs current="margin" />
    </>
  );

  if (failed || data === null) {
    return (
      <div className="pb-12">
        {header}
        <AdminStatusCard failed={failed} onRetry={refresh} />
      </div>
    );
  }

  return (
    <div className="pb-12">
      {header}

      <section aria-labelledby="margin-plans" className="mt-7">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="margin-plans" className="font-serif text-[26px] leading-tight">
            {copy.admin.marginPlanHeading}
          </h2>
          <span className="text-[13px] text-muted-foreground">{copy.admin.marginWindow}</span>
        </div>
        <div className="mt-4">
          <PlanTable rows={data.plans} />
          <PlanCards rows={data.plans} />
        </div>
        {data.completed === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">{copy.admin.marginNoData}</p>
        ) : null}
      </section>

      <section
        aria-labelledby="margin-how"
        className="mt-6 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      >
        <h2 id="margin-how" className="font-serif text-[22px] leading-tight">
          {copy.admin.marginHowTitle}
        </h2>
        <p className="mt-2 text-[13.5px] text-muted-foreground">{copy.admin.marginHowBody}</p>
      </section>

      <BesideCard report={data} />
    </div>
  );
}
