import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PaymentEvent, Payments } from "../platform/ports/payments.ts";

import { readSessionUser } from "../auth/session.ts";
import { cardFingerprintHmac, TRIAL_APPLICATIONS } from "../billing/card-fingerprint.ts";
import { billingAccountOf } from "../billing/plan-account.ts";
import { planForPriceId, stripePriceId } from "../billing/index.ts";
import { createCheckoutCoordinator } from "../billing/checkout.ts";
import { stripeCustomerIdFor } from "../billing/customers.ts";
import { currentSubscriptionOf, subscriptionBlocksCheckout } from "../billing/subscriptions.ts";
import { verifyTrialCardForUser } from "../billing/trial-verify.ts";
import { createPaymentsWebhookService } from "../billing/webhooks.ts";
import { demoLocked } from "../demo/guard.ts";
import { logError } from "../platform/log.ts";
import { defaultMetrics } from "../platform/telemetry/metrics.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { InvalidWebhookSignatureError } from "../platform/ports/payments.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const MAX_WEBHOOK_BYTES = 1_000_000;

const checkoutBodySchema = z.object({ plan: z.enum(["week", "month"]) });

async function readBodyCapped(request: Request, limit: number) {
  const stream = request.body;

  if (stream === null) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for await (const chunk of stream) {
    bytes += chunk.byteLength;

    if (bytes > limit) {
      return null;
    }

    chunks.push(chunk);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

const verifyTrialBodySchema = z.object({ sessionId: z.string().min(1).max(255) });

export function createBillingRoutes(deps: {
  auth: Auth;
  clock: Clock;
  db: AppDatabase;
  payments: Payments | null;
  /** Keys the card fingerprint HMAC; null leaves the free trial off. */
  cardFingerprintSecret: string | null;
  appOrigin: string;
}) {
  const { auth, clock, db, payments, cardFingerprintSecret, appOrigin } = deps;
  const routes = new Hono();
  const baseUrl = appOrigin.replace(/\/+$/u, "");
  const billingUrl = `${baseUrl}/profile/billing`;
  const plansUrl = billingUrl;
  const checkout = payments === null ? null : createCheckoutCoordinator({ clock, db, payments });

  async function signedInAccount(raw: Request) {
    const account = await readSessionUser(auth, raw.headers);

    if (account === null) {
      return { refusal: Response.json({ error: API_ERRORS.signInRequired }, { status: 401 }) };
    }

    return { account };
  }

  async function accountOrRefusal(raw: Request) {
    const access = await signedInAccount(raw);

    if ("refusal" in access) {
      return access;
    }

    const locked = demoLocked(access.account.role);

    if (locked !== null) {
      return { refusal: locked };
    }

    return access;
  }

  routes.get("/billing", async (context) => {
    const access = await signedInAccount(context.req.raw);

    if ("refusal" in access) {
      return access.refusal;
    }

    context.header("Cache-Control", "no-store");

    const subscription = currentSubscriptionOf(db, access.account.id);
    const account = billingAccountOf(db, access.account.id, clock.now());

    return context.json({
      applicationsLeft: account.applicationsLeft,
      balance: account.balance,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      customer: stripeCustomerIdFor(db, access.account.id) !== null,
      enabled: payments !== null,
      plan: subscription?.plan ?? null,
      planApplications: account.planApplications,
      planKind: account.planKind,
      status: subscription?.status ?? null,
    });
  });

  routes.post("/billing/checkout", validJson(checkoutBodySchema), async (context) => {
    const access = await accountOrRefusal(context.req.raw);

    if ("refusal" in access) {
      return access.refusal;
    }

    if (checkout === null) {
      return context.json({ error: "billing_disabled" }, 503);
    }

    const existing = currentSubscriptionOf(db, access.account.id);

    if (existing !== null && subscriptionBlocksCheckout(existing.status)) {
      return context.json(
        { error: "plan_active", plan: existing.plan, status: existing.status },
        409,
      );
    }

    const priceId = stripePriceId(context.req.valid("json").plan);

    if (priceId === null) {
      return context.json({ error: "billing_not_configured" }, 503);
    }

    try {
      const session = await checkout.create({
        cancelUrl: `${plansUrl}?billing=cancelled`,
        email: access.account.email,
        plan: context.req.valid("json").plan,
        priceId,
        successUrl: `${baseUrl}/tracker?billing=success`,
        userId: access.account.id,
      });

      context.header("Cache-Control", "no-store");

      return context.json({ url: session.url });
    } catch (error) {
      logError("billing", error);

      return context.json({ error: "stripe_error" }, 502);
    }
  });

  routes.post("/billing/trial/setup", async (context) => {
    const access = await accountOrRefusal(context.req.raw);

    if ("refusal" in access) {
      return access.refusal;
    }

    if (payments === null || cardFingerprintSecret === null) {
      return context.json({ error: "billing_disabled" }, 503);
    }

    try {
      const origin = appOrigin.replace(/\/+$/u, "");

      const session = await payments.createSetupSession({
        cancelUrl: `${origin}/onboarding/matches?card=cancelled`,
        customerId: stripeCustomerIdFor(db, access.account.id),
        email: access.account.email,
        successUrl: `${origin}/tracker?card=verified&session={CHECKOUT_SESSION_ID}`,
        userId: access.account.id,
      });

      context.header("Cache-Control", "no-store");

      return context.json({ url: session.url });
    } catch (error) {
      logError("billing", error);

      return context.json({ error: "stripe_error" }, 502);
    }
  });

  routes.post("/billing/trial/verify", validJson(verifyTrialBodySchema), async (context) => {
    const access = await accountOrRefusal(context.req.raw);

    if ("refusal" in access) {
      return access.refusal;
    }

    if (payments === null || cardFingerprintSecret === null) {
      return context.json({ error: "billing_disabled" }, 503);
    }

    const verified = await verifyTrialCardForUser(
      { cardFingerprintSecret, clock, db, payments },
      { sessionId: context.req.valid("json").sessionId, userId: access.account.id },
    );

    context.header("Cache-Control", "no-store");

    if (verified.outcome === "stripe_error") {
      return context.json({ error: "stripe_error" }, 502);
    }

    if (verified.outcome === "granted") {
      publishEvent(
        db,
        clock,
        "billing.updated",
        JSON.stringify({ billing: true, trial: true }),
        access.account.id,
      );

      return context.json({ applications: TRIAL_APPLICATIONS, result: "granted" });
    }

    if (verified.outcome === "pending") {
      return context.json({ error: "pending" }, 202);
    }

    if (verified.outcome === "billing_disabled") {
      return context.json({ error: "billing_disabled" }, 503);
    }

    if (verified.outcome === "card_not_verified") {
      return context.json({ error: "card_not_verified" }, 402);
    }

    return context.json({ error: verified.outcome }, 409);
  });

  routes.post("/billing/portal", async (context) => {
    const access = await accountOrRefusal(context.req.raw);

    if ("refusal" in access) {
      return access.refusal;
    }

    if (payments === null) {
      return context.json({ error: "billing_disabled" }, 503);
    }

    const customerId = stripeCustomerIdFor(db, access.account.id);

    if (customerId === null) {
      return context.json({ error: "billing_customer_missing" }, 409);
    }

    try {
      const session = await payments.createPortalSession({ customerId, returnUrl: billingUrl });

      context.header("Cache-Control", "no-store");

      return context.json({ url: session.url });
    } catch (error) {
      logError("billing", error);

      return context.json({ error: "stripe_error" }, 502);
    }
  });

  return routes;
}

export function createStripeWebhookRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  payments: Payments | null;
  /** Keys the card fingerprint HMAC; null leaves the free trial off. */
  cardFingerprintSecret: string | null;
}) {
  const { clock, db, payments, cardFingerprintSecret } = deps;
  const routes = new Hono();

  const webhooks = createPaymentsWebhookService({ clock, db, planForPrice: planForPriceId });

  routes.post("/webhooks/stripe", async (context) => {
    if (payments === null) {
      return context.json({ error: "billing_disabled" }, 503);
    }

    const declaredBytes = Number(context.req.header("content-length") ?? "0");

    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_WEBHOOK_BYTES) {
      return context.body(null, 413);
    }

    const payload = await readBodyCapped(context.req.raw, MAX_WEBHOOK_BYTES);

    if (payload === null) {
      return context.body(null, 413);
    }

    let event: PaymentEvent;

    try {
      event = await payments.verifyWebhook(payload, context.req.header("stripe-signature") ?? null);
    } catch (error) {
      if (error instanceof InvalidWebhookSignatureError) {
        return context.json({ error: "invalid_signature" }, 400);
      }

      throw error;
    }

    defaultMetrics().recordBillingEvent({ event: event.type, plan: event.plan ?? "unknown" });

    let trialCard = null;

    if (
      cardFingerprintSecret !== null &&
      event.type === "checkout.session.completed" &&
      event.mode === "setup" &&
      event.sessionId !== null &&
      event.userId !== null
    ) {
      try {
        const card = await payments.retrieveVerifiedCard(event.sessionId);

        if (card !== null && card.userId === event.userId) {
          trialCard = {
            hmac: cardFingerprintHmac(cardFingerprintSecret, card.fingerprint),
            userId: event.userId,
          };
        }
      } catch (error) {
        logError("billing", error);

        return context.json({ error: "stripe_error" }, 502);
      }
    }

    const result = webhooks.handle(event, trialCard);

    context.header("Cache-Control", "no-store");

    return context.json({ result });
  });

  return routes;
}
