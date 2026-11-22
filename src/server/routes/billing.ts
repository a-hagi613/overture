import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PaymentEvent, Payments } from "../platform/ports/payments.ts";

import { stripePriceId } from "../billing/index.ts";
import { stripeCustomerIdFor } from "../billing/customers.ts";
import { createPaymentsWebhookService } from "../billing/webhooks.ts";
import { demoLocked } from "../demo/guard.ts";
import { logError } from "../platform/log.ts";
import { InvalidWebhookSignatureError } from "../platform/ports/payments.ts";

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

async function sessionUser(auth: Auth, raw: Request) {
  const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

  return result?.user ?? null;
}

export function createBillingRoutes(deps: {
  auth: Auth;
  db: AppDatabase;
  payments: Payments | null;
  appOrigin: string;
}) {
  const { auth, db, payments, appOrigin } = deps;
  const routes = new Hono();
  const settingsUrl = `${appOrigin.replace(/\/+$/u, "")}/settings`;

  async function accountOrRefusal(raw: Request) {
    const account = await sessionUser(auth, raw);

    if (account === null) {
      return { refusal: Response.json({ error: "unauthorised" }, { status: 401 }) };
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return { refusal: locked };
    }

    return { account };
  }

  routes.get("/billing", async (context) => {
    const access = await accountOrRefusal(context.req.raw);

    if ("refusal" in access) {
      return access.refusal;
    }

    context.header("Cache-Control", "no-store");

    return context.json({
      customer: stripeCustomerIdFor(db, access.account.id) !== null,
      enabled: payments !== null,
    });
  });

  routes.post("/billing/checkout", zValidator("json", checkoutBodySchema), async (context) => {
    const access = await accountOrRefusal(context.req.raw);

    if ("refusal" in access) {
      return access.refusal;
    }

    if (payments === null) {
      return context.json({ error: "billing_disabled" }, 503);
    }

    const priceId = stripePriceId(context.req.valid("json").plan);

    if (priceId === null) {
      return context.json({ error: "billing_not_configured" }, 503);
    }

    try {
      const session = await payments.createCheckoutSession({
        cancelUrl: `${settingsUrl}?billing=cancelled`,
        customerId: stripeCustomerIdFor(db, access.account.id),
        email: access.account.email,
        priceId,
        successUrl: `${settingsUrl}?billing=success`,
        userId: access.account.id,
      });

      context.header("Cache-Control", "no-store");

      return context.json({ url: session.url });
    } catch (error) {
      logError("billing", error);

      return context.json({ error: "stripe_error" }, 502);
    }
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
      const session = await payments.createPortalSession({ customerId, returnUrl: settingsUrl });

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
}) {
  const { clock, db, payments } = deps;
  const routes = new Hono();
  const webhooks = createPaymentsWebhookService({ clock, db });

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

    const result = webhooks.handle(event);

    context.header("Cache-Control", "no-store");

    return context.json({ result });
  });

  return routes;
}
