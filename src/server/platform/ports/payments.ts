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
}

/**
 * The one payment provider Overture bills through (ADR 0018, ADR 0031).
 */
export interface Payments {
  createCheckoutSession: (request: CheckoutSessionRequest) => Promise<CheckoutSession>;
  createPortalSession: (request: PortalSessionRequest) => Promise<PortalSession>;
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
