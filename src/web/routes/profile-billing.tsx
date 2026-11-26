import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import type { BillingUpgradeOption } from "../components/billing-upgrade-card.tsx";
import type { BillingPlan, BillingState } from "../lib/billing-api.ts";

import { copy } from "../../shared/copy.ts";
import { PLANS, planAllowanceText } from "../../shared/plans.ts";
import { BillingBalanceCard } from "../components/billing-balance-card.tsx";
import { BillingUpgradeCard } from "../components/billing-upgrade-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "../components/ui/ds.ts";
import { openPortal, startCheckout, useBilling } from "../lib/billing-api.ts";
import { renewalText } from "../lib/billing-format.ts";
import { billingSuccessPollDelay } from "../lib/billing-poll.ts";
import { useHomeData } from "../lib/home-api.ts";

function currentPlanLabel(planKind: BillingState["planKind"]) {
  return copy.home.balance.badge[planKind];
}

function displayAllowance(
  planKind: BillingState["planKind"],
  paidGranted: number,
  allGranted: number,
) {
  const subscribed = planKind === "week" || planKind === "month";

  return subscribed && paidGranted > 0 ? paidGranted : allGranted;
}

function upgradePlansFor(activePlan: BillingPlan | null) {
  if (activePlan === "month") {
    return [] satisfies readonly BillingUpgradeOption[];
  }

  const monthOption: BillingUpgradeOption = {
    bullets: copy.billingPlans.monthBullets,
    featured: true,
    id: "month",
    name: copy.billingPlans.monthName,
    per: copy.billingPlans.monthUnit,
    price: copy.billingPlans.monthPrice,
    title: copy.nav.profilePages.billingUpgradeMonthTitle,
  };

  if (activePlan === "week") {
    return [monthOption] satisfies readonly BillingUpgradeOption[];
  }

  const weekOption: BillingUpgradeOption = {
    bullets: copy.billingPlans.weekBullets,
    featured: false,
    id: "week",
    name: copy.billingPlans.weekName,
    per: copy.billingPlans.weekUnit,
    price: copy.billingPlans.weekPrice,
    title: copy.nav.profilePages.billingUpgradeWeekTitle,
  };

  return [weekOption, monthOption] satisfies readonly BillingUpgradeOption[];
}

export function ProfileBillingPage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const returned = params.get("billing");
  const checkingReturn = returned === "success";
  const bp = copy.nav.profilePages;

  const {
    data: billing,
    isError,
    isFetching,
    isPending,
    refetch,
  } = useBilling({
    refetchInterval: (data, polls) =>
      billingSuccessPollDelay(
        checkingReturn,
        data?.plan ?? null,
        data?.planApplications ?? 0,
        polls,
      ),
  });

  const { data: home } = useHomeData();
  const [upgradingPlan, setUpgradingPlan] = useState<BillingPlan | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  const activePlan = billing?.plan ?? null;
  const planKind = billing?.planKind ?? home?.planKind ?? "none";
  const applicationsLeft = billing?.applicationsLeft ?? home?.applicationsLeft ?? 0;

  const planApplications = displayAllowance(
    planKind,
    billing?.balance.paid.granted ?? 0,
    billing?.planApplications ?? home?.planApplications ?? 0,
  );

  const upgradeOptions = upgradePlansFor(activePlan);
  const switchInStripe = activePlan !== null && billing?.status !== "canceled";

  const billingSignature =
    billing === undefined
      ? null
      : `${billing.planKind}:${String(billing.plan)}:${String(billing.status)}:${String(billing.applicationsLeft)}:${String(billing.planApplications)}:${String(billing.balance.paid.granted)}`;

  const previousSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (billingSignature === null) {
      return;
    }

    const changed =
      previousSignatureRef.current !== null && previousSignatureRef.current !== billingSignature;

    const returnedWithPlan =
      previousSignatureRef.current === null && checkingReturn && activePlan !== null;

    if (changed || returnedWithPlan) {
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["nav"] });
    }

    previousSignatureRef.current = billingSignature;
  }, [activePlan, billingSignature, checkingReturn, queryClient]);

  const renewal =
    billing?.currentPeriodEnd === null || billing?.currentPeriodEnd === undefined
      ? null
      : renewalText(billing.currentPeriodEnd);

  const handleUpgrade = async (plan: BillingPlan) => {
    setUpgradingPlan(plan);

    try {
      globalThis.location.assign(await startCheckout(plan));

      return;
    } catch {
      toast.info(bp.billingCheckoutNote);
    }

    setUpgradingPlan(null);
  };

  const handleOpenStripe = async () => {
    setOpeningPortal(true);

    try {
      globalThis.location.assign(await openPortal());

      return;
    } catch {
      toast.info(bp.billingStripeNote);
    }

    setOpeningPortal(false);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader titleNode={`${bp.billingTitlePlain}${bp.billingTitleItalic}`} />

      {returned === "success" ? (
        <Card className="border-ok/40 p-5">
          <p className="text-sm font-semibold text-foreground">
            {activePlan === null ? copy.billingPlans.checkingTitle : copy.billingPlans.startedTitle}
          </p>
          <p className={`${dsBody} mt-1`}>
            {activePlan === null
              ? copy.billingPlans.checkingBody
              : copy.billingPlans.startedBody(
                  activePlan === "week" ? copy.billingPlans.weekName : copy.billingPlans.monthName,
                  PLANS[activePlan].applications,
                  PLANS[activePlan].periodDays,
                )}
          </p>
        </Card>
      ) : null}

      {returned === "cancelled" ? (
        <Card className="p-5" variant="muted">
          <p className="text-sm font-semibold text-foreground">
            {copy.billingPlans.cancelledTitle}
          </p>
          <p className={`${dsBody} mt-1`}>{copy.billingPlans.cancelledBody}</p>
        </Card>
      ) : null}

      {isPending ? (
        <output
          aria-busy="true"
          className="block animate-pulse space-y-5"
          data-testid="billing-loading"
        >
          <span className="sr-only">{copy.settingsBilling.loading}</span>
          <div aria-hidden="true" className="h-32 rounded-lg border border-border bg-card" />
          <div aria-hidden="true" className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="h-48 rounded-lg border border-border bg-card" />
            <div className="h-48 rounded-lg border border-border bg-card" />
          </div>
        </output>
      ) : null}

      {!isPending && isError && billing === undefined ? (
        <Card className="p-6">
          <div role="alert">
            <h2 className={dsCardTitle}>{copy.settingsBilling.unavailable}</h2>
            <p className={`${dsBody} mt-1.5`}>{copy.calendar.errorBody}</p>
          </div>
          <Button
            className="mt-4"
            disabled={isFetching}
            onClick={() => {
              void refetch();
            }}
            size="default"
            variant="outline"
          >
            {copy.calendar.retry}
          </Button>
        </Card>
      ) : null}

      {!isPending && billing !== undefined ? (
        <div className="flex flex-col gap-5">
          <Card ariaLabelledBy="billing-current-heading" className="p-5 md:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className={dsEyebrow}>{bp.billingCurrentPlan}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                  <h2 className={dsCardTitle} id="billing-current-heading">
                    {currentPlanLabel(planKind)}
                  </h2>
                  {planKind !== "none" || planApplications > 0 ? (
                    <Badge variant="ok">{bp.billingActiveBadge}</Badge>
                  ) : null}
                </div>
                <p className={`${dsBody} mt-1.5 tabular-nums`}>
                  {planKind === "none"
                    ? copy.settingsBilling.noPlanDetail
                    : planAllowanceText(planKind)}
                  {renewal === null ? "" : ` · ${copy.settingsBilling.renews} ${renewal}`}
                </p>
                {planApplications > 0 ? (
                  <p className={`${dsBody} mt-0.5 tabular-nums`}>
                    {bp.billingRemaining(applicationsLeft, planApplications)}
                  </p>
                ) : null}
              </div>
              <Button
                className="shrink-0 self-start sm:self-auto"
                disabled={openingPortal}
                onClick={() => {
                  void handleOpenStripe();
                }}
                size="default"
                variant="secondary"
              >
                <span>{bp.billingManageStripe}</span>
                <ExternalLink aria-hidden="true" size={14} />
              </Button>
            </div>
            {planApplications > 0 ? (
              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                  <span>{copy.settingsBilling.leftHeading}</span>
                  <span>
                    {copy.settingsBilling.usageSummary(applicationsLeft, planApplications)}
                  </span>
                </div>
                <progress
                  aria-label={copy.settingsBilling.leftHeading}
                  className="ov-progress block h-2 w-full"
                  max={planApplications}
                  value={applicationsLeft}
                />
              </div>
            ) : null}
          </Card>

          <BillingBalanceCard balance={billing.balance} />

          {upgradeOptions.length === 0 ? (
            <Card ariaLabelledBy="billing-top-heading" className="p-6">
              <p className={dsEyebrow}>{bp.billingCurrentPlan}</p>
              <h2 className={`${dsCardTitle} mt-1.5`} id="billing-top-heading">
                {bp.billingTopPlanTitle}
              </h2>
              <p className={`${dsBody} mt-1.5 max-w-2xl`}>{bp.billingTopPlanBody}</p>
              <div className="mt-5">
                <Button
                  disabled={openingPortal}
                  onClick={() => {
                    void handleOpenStripe();
                  }}
                  size="default"
                  variant="secondary"
                >
                  <span>{bp.billingManageStripe}</span>
                  <ExternalLink aria-hidden="true" size={14} />
                </Button>
              </div>
            </Card>
          ) : (
            <div
              className={
                upgradeOptions.length > 1 ? "grid grid-cols-1 gap-5 md:grid-cols-2" : "space-y-5"
              }
            >
              {upgradeOptions.map((option) => (
                <BillingUpgradeCard
                  busy={upgradingPlan === option.id}
                  disabled={switchInStripe ? openingPortal : upgradingPlan !== null}
                  key={option.id}
                  onSelect={() => {
                    if (switchInStripe) {
                      void handleOpenStripe();

                      return;
                    }

                    void handleUpgrade(option.id);
                  }}
                  option={option}
                  switchInStripe={switchInStripe}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
