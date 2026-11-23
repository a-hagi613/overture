import { ArrowUpRight, Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import type { BillingPlan } from "../lib/billing-api.ts";

import { copy } from "../../shared/copy.ts";
import { PLANS } from "../../shared/plans.ts";
import { PageHeader } from "../components/page-header.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow, dsMetric } from "../components/ui/ds.ts";
import { openPortal, startCheckout, useBilling } from "../lib/billing-api.ts";
import { renewalText } from "../lib/billing-format.ts";
import { useHomeData } from "../lib/home-api.ts";

function currentPlanLabel(plan: BillingPlan | null, totalApps: number) {
  if (plan === "week") {
    return copy.settingsBilling.weekPlan;
  }

  if (plan === "month") {
    return copy.settingsBilling.monthPlan;
  }

  if (totalApps > 0) {
    return copy.nav.profilePages.billingTrialPlan;
  }

  return copy.nav.profilePages.billingNoPlan;
}

function nextUpgradePlan(activePlan: BillingPlan | null) {
  if (activePlan === "month") {
    return null;
  }

  if (activePlan === "week") {
    return {
      detail: copy.billingPlans.monthDetail,
      id: "month" as const,
      name: copy.billingPlans.monthName,
      per: copy.billingPlans.monthUnit,
      price: copy.billingPlans.monthPrice,
      title: copy.nav.profilePages.billingUpgradeMonthTitle,
    };
  }

  return {
    detail: copy.billingPlans.weekDetail,
    id: "week" as const,
    name: copy.billingPlans.weekName,
    per: copy.billingPlans.weekUnit,
    price: copy.billingPlans.weekPrice,
    title: copy.nav.profilePages.billingUpgradeWeekTitle,
  };
}

export function ProfileBillingPage() {
  const [params] = useSearchParams();
  const returned = params.get("billing");
  const checkingReturn = returned === "success";
  const bp = copy.nav.profilePages;

  const { data: billing } = useBilling({
    refetchInterval: checkingReturn ? 3000 : false,
  });

  const { data: home } = useHomeData();
  const [upgrading, setUpgrading] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  const activePlan = billing?.plan ?? null;
  const applicationsLeft = billing?.applicationsLeft ?? home?.applicationsLeft ?? 0;
  const planApplications = billing?.planApplications ?? home?.planApplications ?? 0;
  const upgradeTarget = nextUpgradePlan(activePlan);

  const renewal =
    billing?.currentPeriodEnd === null || billing?.currentPeriodEnd === undefined
      ? null
      : renewalText(billing.currentPeriodEnd);

  const handleUpgrade = async (plan: BillingPlan) => {
    setUpgrading(true);

    try {
      globalThis.location.assign(await startCheckout(plan));

      return;
    } catch {
      toast.info(bp.billingCheckoutNote);
    }

    setUpgrading(false);
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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        lead={bp.billingLead}
        titleNode={
          <>
            {bp.billingTitlePlain}
            <em className="italic text-signal">{bp.billingTitleItalic}</em>
          </>
        }
      />

      {returned === "success" ? (
        <Card className="mt-6 border-ok/40 p-5" variant="elevated">
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
        <Card className="mt-6 p-5" variant="muted">
          <p className="text-sm font-semibold text-foreground">
            {copy.billingPlans.cancelledTitle}
          </p>
          <p className={`${dsBody} mt-1`}>{copy.billingPlans.cancelledBody}</p>
        </Card>
      ) : null}

      <div className="mt-6 flex flex-col gap-5">
        <Card ariaLabelledBy="billing-current-heading" className="p-6" variant="elevated">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className={dsEyebrow}>{bp.billingCurrentPlan}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                <h2 className={dsCardTitle} id="billing-current-heading">
                  {currentPlanLabel(activePlan, planApplications)}
                </h2>
                {activePlan !== null || planApplications > 0 ? (
                  <Badge variant="ok">{bp.billingActiveBadge}</Badge>
                ) : null}
              </div>
              <p className={`${dsBody} mt-1.5 tabular-nums`}>
                {planApplications > 0
                  ? bp.billingRemaining(applicationsLeft, planApplications)
                  : copy.settingsBilling.noPlanDetail}
                {renewal === null ? "" : ` · ${copy.settingsBilling.renews} ${renewal}`}
              </p>
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
        </Card>

        {upgradeTarget === null ? (
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
          <Card
            ariaLabelledBy="billing-upgrade-heading"
            className="border-signal/60 p-6"
            variant="elevated"
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <p className={dsEyebrow}>{bp.billingUpgradeEyebrow}</p>
                  <Badge variant="signal">{bp.billingPopularBadge}</Badge>
                </div>
                <h2 className={`${dsCardTitle} mt-1.5`} id="billing-upgrade-heading">
                  {upgradeTarget.title}
                </h2>
                <div className="mt-3 flex items-baseline gap-1.5 tabular-nums">
                  <span className={dsMetric}>{upgradeTarget.price}</span>
                  <span className="text-sm text-muted-foreground">{upgradeTarget.per}</span>
                </div>
                <p className="mt-3 flex items-start gap-2 text-sm text-foreground">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-signal-text"
                    size={16}
                  />
                  <span>{upgradeTarget.detail}</span>
                </p>
              </div>
              <Button
                className="shrink-0 self-start sm:self-auto"
                disabled={upgrading}
                onClick={() => {
                  void handleUpgrade(upgradeTarget.id);
                }}
                size="lg"
                variant="primary"
              >
                <span>{bp.billingUpgradeAction(upgradeTarget.name)}</span>
                <ArrowUpRight aria-hidden="true" size={16} />
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
