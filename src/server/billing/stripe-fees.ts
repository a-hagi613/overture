/**
 * Regular Stripe Billing fees, not Managed Payments (ADR 0018, issue #564):
 * a domestic card costs 2.9 % and Stripe Billing adds 0.7 %, so 3.6 % + $0.30
 * per charge; an international card costs 4.4 % + 0.7 %, so 5.1 % + $0.30.
 * Fees are rounded to whole cents, as Stripe charges them. The margin report
 * measures profit against the net revenue these leave, not the gross price.
 */

export const STRIPE_CARD_RATE_DOMESTIC = 0.029;
export const STRIPE_CARD_RATE_INTERNATIONAL = 0.044;
export const STRIPE_BILLING_RATE = 0.007;
export const STRIPE_FIXED_FEE_CENTS = 30;
export const STRIPE_FIXED_FEE_MICROS = STRIPE_FIXED_FEE_CENTS * 10_000;

function feeRateOf(cardRate: number) {
  return Math.round((cardRate + STRIPE_BILLING_RATE) * 10_000) / 10_000;
}

export const STRIPE_DOMESTIC_FEE_RATE = feeRateOf(STRIPE_CARD_RATE_DOMESTIC);
export const STRIPE_INTERNATIONAL_FEE_RATE = feeRateOf(STRIPE_CARD_RATE_INTERNATIONAL);

const CENTS_PER_MICRO = 10_000;

/**
 * What one charge costs in Stripe fees, rounded to cents. A free price costs
 * nothing: no charge means no fee.
 * @param priceMicros The plan's price in micros.
 * @param feeRate The card rate plus the Billing rate, such as 0.036 domestic.
 * @returns The fee in micros.
 */
export function stripeFeeMicros(priceMicros: number, feeRate: number) {
  if (priceMicros <= 0) {
    return 0;
  }

  const priceCents = Math.round(priceMicros / CENTS_PER_MICRO);

  return (Math.round(priceCents * feeRate) + STRIPE_FIXED_FEE_CENTS) * CENTS_PER_MICRO;
}

/**
 * Net revenue per Application after Stripe's fee: the baseline the margin is
 * measured against, $0.114 on Month and $0.187 on Week domestic.
 * @param priceMicros The plan's price in micros.
 * @param applications The Applications one period grants.
 * @param feeRate The card rate plus the Billing rate.
 * @returns Net revenue per Application in micros.
 */
export function netRevenueMicrosPerApplication(
  priceMicros: number,
  applications: number,
  feeRate = STRIPE_DOMESTIC_FEE_RATE,
) {
  const netMicros = priceMicros - stripeFeeMicros(priceMicros, feeRate);

  return Math.round(netMicros / applications);
}
