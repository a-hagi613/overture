import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BillingPlanCard } from "../components/billing-plan-card.tsx";
import {
  BILLING_BUTTON_PRIMARY,
  BILLING_BUTTON_SECONDARY,
  BILLING_CARD,
} from "../components/billing-classes.ts";
import { PageHeader } from "../components/page-header.tsx";
import { SettingsAccountTabs } from "../components/settings-account-tabs.tsx";
import { openPortal, useBilling } from "../lib/billing-api.ts";
import { renewalText } from "../lib/billing-format.ts";

const COPY = copy.settingsBilling;

export function SettingsBillingPage() {
  const { data: billing, isError } = useBilling();
  const [opening, setOpening] = useState(false);
  const [portalFailed, setPortalFailed] = useState(false);

  async function manageInStripe() {
    setOpening(true);
    setPortalFailed(false);

    try {
      globalThis.location.assign(await openPortal());
    } catch {
      setPortalFailed(true);
      setOpening(false);
    }
  }

  function openStripe() {
    void manageInStripe();
  }

  let body;

  if (isError) {
    body = (
      <p className="mt-7 text-sm text-need" role="alert">
        {COPY.unavailable}
      </p>
    );
  } else if (billing === undefined) {
    body = <output className="mt-7 block text-sm text-muted-foreground">{COPY.loading}</output>;
  } else {
    const renewal =
      billing.currentPeriodEnd === null ? null : renewalText(billing.currentPeriodEnd);

    const changeable = billing.plan !== null && !billing.cancelAtPeriodEnd && billing.enabled;

    body = (
      <div className="mt-7 grid grid-cols-1 items-start gap-5 min-[900px]:grid-cols-2">
        <BillingPlanCard billing={billing} />
        {billing.plan === null ? null : (
          <section aria-labelledby="billing-switch" className={BILLING_CARD}>
            <h2 className="font-serif text-[26px] leading-[1.1]" id="billing-switch">
              {COPY.switchHeading}
            </h2>
            {renewal === null ? null : (
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {COPY.switchDetail(renewal)}
              </p>
            )}
            {changeable ? (
              <div className="mt-3">
                <button
                  className={BILLING_BUTTON_SECONDARY}
                  disabled={opening}
                  onClick={openStripe}
                  type="button"
                >
                  {billing.plan === "week" ? COPY.switchToMonth : COPY.switchToWeek}
                </button>
              </div>
            ) : null}
          </section>
        )}
        {billing.plan === null ? null : (
          <section aria-labelledby="billing-cancel" className={BILLING_CARD}>
            <h2 className="font-serif text-[26px] leading-[1.1]" id="billing-cancel">
              {COPY.cancelHeading}
            </h2>
            {renewal === null ? null : (
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {COPY.cancelDetail(renewal)}
              </p>
            )}
            {changeable ? (
              <div className="mt-3">
                <button
                  className={BILLING_BUTTON_SECONDARY}
                  disabled={opening}
                  onClick={openStripe}
                  type="button"
                >
                  {COPY.cancelButton}
                </button>
              </div>
            ) : null}
          </section>
        )}
        <section aria-labelledby="billing-payment" className={BILLING_CARD}>
          <h2 className="font-serif text-[26px] leading-[1.1]" id="billing-payment">
            {COPY.paymentHeading}
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{COPY.paymentDetail}</p>
          {billing.enabled && billing.customer ? (
            <div className="mt-3 flex flex-wrap gap-2.5">
              <button
                className={BILLING_BUTTON_PRIMARY}
                disabled={opening}
                onClick={openStripe}
                type="button"
              >
                {COPY.managePayment}
              </button>
              <button
                className={BILLING_BUTTON_SECONDARY}
                disabled={opening}
                onClick={openStripe}
                type="button"
              >
                {COPY.viewInvoices}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-muted-foreground">{COPY.billingOff}</p>
          )}
          {portalFailed ? (
            <p className="mt-2 text-[12.5px] text-need" role="alert">
              {COPY.portalError}
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[940px]">
      <PageHeader
        lead={COPY.lead}
        titleNode={
          <>
            {COPY.titlePlain} <span className="italic">{COPY.titleItalic}</span>
          </>
        }
      />
      <SettingsAccountTabs active="billing" />
      {body}
      {billing?.plan === null ? (
        <p className="mt-5 text-[12.5px] text-muted-foreground">
          <Link
            className="font-semibold text-foreground underline hover:text-muted-foreground"
            to="/pricing"
          >
            {COPY.pricingLink}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
