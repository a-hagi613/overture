/**
 * The plan a user can buy (ADR 0018).
 */
export type BillingPlan = "week" | "month";

/**
 * What Overture asks Stripe to charge for.
 */
export interface CheckoutSessionRequest {
  userId: string;
  email: string;
  customerId: string | null;
  plan: BillingPlan;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * A hosted Stripe Checkout page the user is sent to.
 */
export interface CheckoutSession {
  id: string;
  url: string;
}

/**
 * What Overture asks Stripe for to verify a card: a setup-only Checkout
 * session. Nothing is charged (M3 free trial).
 */
export interface SetupSessionRequest {
  userId: string;
  email: string;
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
}

/**
 * The card a completed setup session verified. `fingerprint` is Stripe's raw
 * card fingerprint; the caller keys it with HMAC before storing anything.
 */
export interface VerifiedCard {
  fingerprint: string;
  customerId: string | null;
  /** The account the setup session was created for (its client_reference_id). */
  userId: string | null;
}

/**
 * A hosted Stripe customer portal page the user is sent to.
 */
export interface PortalSessionRequest {
  customerId: string;
  returnUrl: string;
}

/**
 * A hosted Stripe customer portal page.
 */
export interface PortalSession {
  id: string;
  url: string;
}

/**
 * A Stripe event after its signature was verified, reduced to the fields the
 * billing code acts on. The adapter parses the provider payload, so domain
 * code never handles a raw dictionary.
 */
export interface PaymentEvent {
  id: string;
  type: string;
  customerId: string | null;
  userId: string | null;
  /** The invoice a paid subscription event names, or null for other events. */
  invoiceId: string | null;
  /** The subscription the event names, or null when it names none. */
  subscriptionId: string | null;
  /** The plan the subscription metadata names, when the event carries it. */
  plan: BillingPlan | null;
  /** The Stripe price the paid line item or subscription item names, when the event carries one. */
  priceId: string | null;
  /** The end of the paid period in epoch milliseconds, or null when unknown. */
  periodEndMs: number | null;
  /** The start of the paid period in epoch milliseconds, or null when unknown. */
  periodStartMs: number | null;
  /** Checkout mode ("setup" for the free trial card), or null for other events. */
  mode: string | null;
  /** The Checkout session id for session events, or null. */
  sessionId: string | null;
  /**
   * Stripe's own subscription status (`trialing`, `active`, `past_due`,
   * `canceled`, …) for a `customer.subscription.*` event, stored verbatim so a
   * status Stripe adds tomorrow still lands instead of failing the webhook.
   */
  subscriptionStatus: string | null;
  /**
   * Whether Stripe will cancel the subscription at the period end the event
   * names, for a `customer.subscription.*` event, or null for other events.
   */
  cancelAtPeriodEnd: boolean | null;
}

/**
 * A refund of the payment behind a paid invoice. The key makes a retry return
 * the same refund at the provider instead of refunding twice.
 */
export interface RefundRequest {
  invoiceId: string;
  /** Cents to return, or null to return the whole payment. */
  amountCents: number | null;
  idempotencyKey: string;
}

/**
 * The refund the provider accepted, in cents.
 */
export interface Refund {
  id: string;
  status: string;
  amountCents: number;
}

/**
 * A half-open window of provider time in epoch milliseconds: a record at
 * `sinceMs` is inside it, a record at `untilMs` is not.
 */
export interface BillingWindow {
  sinceMs: number;
  untilMs: number;
}

/**
 * A paid invoice the provider reports, reduced to the fields reconciliation
 * compares against the ledger.
 */
export interface ProviderInvoice {
  invoiceId: string;
  amountPaidCents: number;
  paidAtMs: number;
  customerId: string | null;
}

/**
 * A refund the provider reports, reduced to the fields reconciliation compares
 * against the ledger.
 */
export interface ProviderRefund {
  refundId: string;
  amountCents: number;
  createdAtMs: number;
}

/**
 * The one payment provider Overture bills through (ADR 0018, ADR 0031).
 */
export interface Payments {
  createCheckoutSession: (request: CheckoutSessionRequest) => Promise<CheckoutSession>;
  createSetupSession: (request: SetupSessionRequest) => Promise<CheckoutSession>;
  /** `null` until the setup session is complete and its card is attached. */
  retrieveVerifiedCard: (setupSessionId: string) => Promise<VerifiedCard | null>;
  createPortalSession: (request: PortalSessionRequest) => Promise<PortalSession>;
  refundInvoice: (request: RefundRequest) => Promise<Refund>;
  listPaidInvoices: (window: BillingWindow) => Promise<ProviderInvoice[]>;
  listRefunds: (window: BillingWindow) => Promise<ProviderRefund[]>;
  verifyWebhook: (payload: string, signature: string | null) => Promise<PaymentEvent>;
}

/**
 * A webhook whose signature, timestamp or body did not verify, so the caller
 * must reject it before touching any stored billing state.
 */
export class InvalidWebhookSignatureError extends Error {
  constructor(message = "The Stripe webhook signature is invalid.") {
    super(message);
    this.name = "InvalidWebhookSignatureError";
  }
}

/**
 * An invoice with no card payment behind it, so there is nothing to refund.
 */
export class NoRefundablePaymentError extends Error {
  constructor(message = "This payment has no Stripe payment to refund.") {
    super(message);
    this.name = "NoRefundablePaymentError";
  }
}
