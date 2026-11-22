import { useCallback, useState } from "react";
import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { loadBillingReconciliation, loadBillingUsers } from "../../lib/admin-api.ts";
import type {
  BillingFilter,
  BillingReconciliation,
  BillingUserRow,
  BillingUsersResponse,
} from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { BillingReconcile } from "./billing-reconcile.tsx";
import { BillingStatCard } from "./billing-stat-card.tsx";
import { BillingTabs } from "./billing-tabs.tsx";
import { BillingStatePill } from "./billing-format.tsx";
import { BILLING_FILTER_ORDER, billingPlanLabel, dayOf } from "./billing-labels.ts";

const FILTER_BUTTON =
  "min-h-11 rounded-md px-3.5 text-[13px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

function periodText(row: BillingUserRow) {
  return row.expiresAt === null
    ? copy.admin.billingNoPeriod
    : copy.admin.billingEndsOn(dayOf(row.expiresAt));
}

function usageText(row: BillingUserRow) {
  return row.usage === null
    ? copy.admin.billingNoPeriod
    : copy.admin.billingUsed(row.usage.used, row.usage.quantity);
}

type BillingPageData = BillingUsersResponse & {
  reconciliation: BillingReconciliation | null;
};

export function BillingPage() {
  const [filter, setFilter] = useState<BillingFilter>("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const [users, reconciliation] = await Promise.all([
      loadBillingUsers(filter, page),
      loadBillingReconciliation(),
    ]);

    if (!users.ok) {
      return { ok: false as const, refusal: users.refusal };
    }

    if (!reconciliation.ok) {
      return { ok: false as const, refusal: reconciliation.refusal };
    }

    return {
      data: { ...users.data, reconciliation: reconciliation.data.reconciliation },
      ok: true as const,
    };
  }, [filter, page]);

  const { data, refusal, refresh } = useAdminResource<BillingPageData>(load);

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

  const { pageSize } = data;
  const from = data.total === 0 ? 0 : (data.page - 1) * pageSize + 1;
  const to = Math.min(data.page * pageSize, data.total);
  const hasNext = data.page * pageSize < data.total;

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.billingTitleItalic}
        lead={copy.admin.billingLead}
        plain={copy.admin.billingTitlePlain}
      />
      <p className="mt-2 max-w-[60ch] text-[13px] text-muted-foreground">
        {copy.admin.billingIntro}
      </p>

      <BillingTabs current="users" />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BillingStatCard
          hint={copy.admin.billingStatTrialHint}
          label={copy.admin.billingStatOnTrial}
          value={data.counts.onTrial}
        />
        <BillingStatCard
          hint={copy.admin.billingStatPayingHint}
          label={copy.admin.billingStatPaying}
          value={data.counts.paying}
        />
        <BillingStatCard
          hint={copy.admin.billingStatPausedHint}
          label={copy.admin.billingStatPaused}
          value={data.counts.paused}
        />
        <BillingStatCard
          hint={copy.admin.billingStatEndingHint}
          label={copy.admin.billingStatEnding}
          value={data.counts.endingSoon}
        />
      </div>

      <BillingReconcile reconciliation={data.reconciliation} />

      <div
        aria-label={copy.admin.billingFilterLabel}
        className="mt-5 inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
      >
        {BILLING_FILTER_ORDER.map((key) => {
          const selected = key === filter;

          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              className={`${FILTER_BUTTON} ${selected ? "bg-background font-semibold shadow-sh" : "text-muted-foreground"}`}
              onClick={() => {
                setFilter(key);
                setPage(1);
              }}
            >
              {copy.admin.billingFilters[key]}
            </button>
          );
        })}
      </div>

      <ul
        aria-label={copy.admin.navBilling}
        className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sh md:hidden"
      >
        {data.users.length === 0 ? (
          <li className="px-4 py-6 text-[13px] text-muted-foreground">{copy.admin.billingEmpty}</li>
        ) : (
          data.users.map((row) => (
            <li key={row.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/admin/billing/users/${encodeURIComponent(row.id)}`}
                    className="block min-h-11 break-all rounded-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    {row.name}
                  </Link>
                  {row.name === row.email ? null : (
                    <span className="block break-all text-[12px] text-muted-foreground">
                      {row.email}
                    </span>
                  )}
                </div>
                <BillingStatePill state={row.state} />
              </div>
              <p className="mt-1 text-[13px]">
                {billingPlanLabel(row.plan)}
                {" · "}
                {periodText(row)}
              </p>
              <p className="text-[13px] text-muted-foreground">{usageText(row)}</p>
            </li>
          ))
        )}
      </ul>
      <section
        aria-label={copy.admin.navBilling}
        className="mt-4 hidden overflow-x-auto rounded-lg border border-border bg-card shadow-sh md:block"
      >
        <table
          className={`w-full border-collapse text-left text-[13px] ${data.users.length === 0 ? "" : "min-w-[640px]"}`}
        >
          <thead className="bg-muted text-[12px] text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingColumnUser}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingColumnPlan}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingColumnPeriod}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingColumnUsage}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {copy.admin.billingColumnStatus}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                  {copy.admin.billingEmpty}
                </td>
              </tr>
            ) : (
              data.users.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-muted/60">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/billing/users/${encodeURIComponent(row.id)}`}
                      className="block min-h-11 rounded-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    >
                      {row.name.length > 0 ? row.name : copy.admin.billingUserNameFallback}
                    </Link>
                    {row.name === row.email ? null : (
                      <span className="block text-[12px] text-muted-foreground">{row.email}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{billingPlanLabel(row.plan)}</td>
                  <td className="px-4 py-3">{periodText(row)}</td>
                  <td className="px-4 py-3">{usageText(row)}</td>
                  <td className="px-4 py-3">
                    <BillingStatePill state={row.state} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
        <span>{copy.admin.billingShowing(from, to, data.total)}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={data.page <= 1}
            className="min-h-11 rounded-md border border-input bg-card px-4 hover:bg-muted disabled:opacity-50 md:min-h-9"
            onClick={() => {
              setPage((current) => Math.max(1, current - 1));
            }}
          >
            {copy.admin.billingPrevious}
          </button>
          <button
            type="button"
            disabled={!hasNext}
            className="min-h-11 rounded-md border border-input bg-card px-4 hover:bg-muted disabled:opacity-50 md:min-h-9"
            onClick={() => {
              setPage((current) => current + 1);
            }}
          >
            {copy.admin.billingNext}
          </button>
        </div>
      </div>
    </>
  );
}
