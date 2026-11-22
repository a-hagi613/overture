import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { Clock } from "../platform/ports/clock.ts";
import type {
  CheckoutSessionRequest,
  PaymentEvent,
  Payments,
  PortalSessionRequest,
  SetupSessionRequest,
} from "../platform/ports/payments.ts";

import { InvalidWebhookSignatureError } from "../platform/ports/payments.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const WEBHOOK_TOLERANCE_SECONDS = 300;

const signaturePartPattern = /^(?<name>[^=]+)=(?<value>.*)$/u;
const timestampPattern = /^\d+$/u;
const hexPattern = /^[0-9a-f]+$/u;

const checkoutSessionSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
});

const setupSessionSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
});

const verifiedSetupSessionSchema = z.object({
  mode: z.string().nullable().optional(),
  status: z.string().nullable(),
  client_reference_id: z.string().nullable().optional(),
  customer: z.string().nullable().optional(),
  setup_intent: z
    .object({
      status: z.string(),
      payment_method: z
        .object({
          card: z.object({ fingerprint: z.string().nullable() }).nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const portalSessionSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
});

const metadataSchema = z.object({
  plan: z.string().optional(),
  user_id: z.string().optional(),
});

const planNames = ["month", "week"] as const;

function planOf(value: string | undefined) {
  return planNames.find((plan) => plan === value) ?? null;
}

const lineSchema = z.object({
  period: z
    .object({ end: z.number().optional(), start: z.number().optional() })
    .nullable()
    .optional(),
  price: z.object({ id: z.string() }).nullable().optional(),
  pricing: z
    .object({
      price_details: z.object({ price: z.string() }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.object({
      id: z.string().optional(),
      client_reference_id: z.string().nullable().optional(),
      customer: z.string().nullable().optional(),
      mode: z.string().nullable().optional(),
      lines: z
        .object({ data: z.array(lineSchema).optional() })
        .nullable()
        .optional(),
      metadata: metadataSchema.nullable().optional(),
      parent: z
        .object({
          subscription_details: z
            .object({ metadata: metadataSchema.nullable().optional() })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
      subscription_details: z
        .object({ metadata: metadataSchema.nullable().optional() })
        .nullable()
        .optional(),
    }),
  }),
});

function signatureParts(header: string) {
  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const groups = signaturePartPattern.exec(part.trim())?.groups;
    const name = groups?.["name"];
    const value = groups?.["value"];

    if (name === undefined || value === undefined) {
      continue;
    }

    if (name === "t") {
      timestamp = value;
    }

    if (name === "v1") {
      signatures.push(value);
    }
  }

  return { signatures, timestamp };
}

async function hmacHex(secret: string, message: string) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));

  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function matchesAnySignature(expected: string, candidates: readonly string[]) {
  const expectedBytes = Buffer.from(expected, "hex");

  return candidates.some((candidate) => {
    if (!hexPattern.test(candidate)) {
      return false;
    }

    const candidateBytes = Buffer.from(candidate, "hex");

    return (
      candidateBytes.byteLength === expectedBytes.byteLength &&
      timingSafeEqual(candidateBytes, expectedBytes)
    );
  });
}

function priceIdOf(line: z.infer<typeof lineSchema>) {
  return line.pricing?.price_details?.price ?? line.price?.id ?? null;
}

function eventFrom(parsed: z.infer<typeof eventSchema>) {
  const { object } = parsed.data;

  const subscriptionMetadata =
    object.parent?.subscription_details?.metadata ?? object.subscription_details?.metadata ?? null;

  const userId =
    object.client_reference_id ?? subscriptionMetadata?.user_id ?? object.metadata?.user_id ?? null;

  const customerId = object.customer ?? (parsed.type.startsWith("customer.") ? object.id : null);
  const lines = object.lines?.data ?? [];
  let periodEndSeconds = 0;
  let periodStartSeconds = 0;
  let priceId: string | null = null;

  for (const line of lines) {
    periodEndSeconds = Math.max(periodEndSeconds, line.period?.end ?? 0);
    periodStartSeconds = Math.max(periodStartSeconds, line.period?.start ?? 0);
    priceId ??= priceIdOf(line);
  }

  const isSession = parsed.type.startsWith("checkout.session.");

  const event: PaymentEvent = {
    customerId: customerId ?? null,
    id: parsed.id,
    invoiceId: parsed.type.startsWith("invoice.") ? (object.id ?? null) : null,
    periodEndMs: periodEndSeconds > 0 ? periodEndSeconds * 1000 : null,
    periodStartMs: periodStartSeconds > 0 ? periodStartSeconds * 1000 : null,
    plan: planOf(object.metadata?.plan) ?? planOf(subscriptionMetadata?.plan),
    priceId,
    mode: object.mode ?? null,
    sessionId: isSession ? (object.id ?? null) : null,
    type: parsed.type,
    userId,
  };

  return event;
}

export interface StripePaymentsConfig {
  secretKey: string;
  webhookSecret: string;
  apiBaseUrl: string;
  clock: Clock;
  toleranceSeconds?: number;
}

export function createStripePayments(config: StripePaymentsConfig) {
  const apiBaseUrl = config.apiBaseUrl.replace(/\/+$/u, "");
  const toleranceSeconds = config.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;

  async function postForm(path: string, form: URLSearchParams) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const requestId = response.headers.get("request-id") ?? "unknown";

      throw new Error(
        `Stripe ${path} failed with ${String(response.status)} (request ${requestId})`,
      );
    }

    const payload: unknown = await response.json();

    return payload;
  }

  async function getJson(path: string) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: { authorization: `Bearer ${config.secretKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const requestId = response.headers.get("request-id") ?? "unknown";

      throw new Error(
        `Stripe ${path} failed with ${String(response.status)} (request ${requestId})`,
      );
    }

    const payload: unknown = await response.json();

    return payload;
  }

  async function verifyWebhook(payload: string, signature: string | null) {
    if (signature === null) {
      throw new InvalidWebhookSignatureError("The Stripe webhook carried no signature.");
    }

    const { signatures, timestamp } = signatureParts(signature);

    if (timestamp === null || !timestampPattern.test(timestamp) || signatures.length === 0) {
      throw new InvalidWebhookSignatureError("The Stripe webhook signature is malformed.");
    }

    const sentAt = Number(timestamp);
    const nowSeconds = Math.trunc(config.clock.now() / 1000);

    if (Math.abs(nowSeconds - sentAt) > toleranceSeconds) {
      throw new InvalidWebhookSignatureError("The Stripe webhook signature is outside its window.");
    }

    const expected = await hmacHex(config.webhookSecret, `${timestamp}.${payload}`);

    if (!matchesAnySignature(expected, signatures)) {
      throw new InvalidWebhookSignatureError();
    }

    let body: unknown;

    try {
      body = JSON.parse(payload);
    } catch {
      throw new InvalidWebhookSignatureError("The Stripe webhook body is not JSON.");
    }

    const parsed = eventSchema.safeParse(body);

    if (!parsed.success) {
      throw new InvalidWebhookSignatureError("The Stripe webhook body is not an event.");
    }

    return eventFrom(parsed.data);
  }

  const payments: Payments = {
    createCheckoutSession: async (request: CheckoutSessionRequest) => {
      const form = new URLSearchParams({
        client_reference_id: request.userId,
        "line_items[0][price]": request.priceId,
        "line_items[0][quantity]": "1",
        "metadata[plan]": request.plan,
        "metadata[user_id]": request.userId,
        mode: "subscription",
        "subscription_data[metadata][plan]": request.plan,
        "subscription_data[metadata][user_id]": request.userId,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
      });

      if (request.customerId === null) {
        form.set("customer_email", request.email);
      } else {
        form.set("customer", request.customerId);
      }

      const session = checkoutSessionSchema.parse(await postForm("/v1/checkout/sessions", form));

      return { id: session.id, url: session.url };
    },
    createSetupSession: async (request: SetupSessionRequest) => {
      const form = new URLSearchParams({
        client_reference_id: request.userId,
        mode: "setup",
        "metadata[user_id]": request.userId,
        "setup_intent_data[metadata][user_id]": request.userId,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
      });

      if (request.customerId === null) {
        form.set("customer_creation", "always");
        form.set("customer_email", request.email);
      } else {
        form.set("customer", request.customerId);
      }

      const session = setupSessionSchema.parse(await postForm("/v1/checkout/sessions", form));

      return { id: session.id, url: session.url };
    },
    retrieveVerifiedCard: async (setupSessionId: string) => {
      const path = `/v1/checkout/sessions/${encodeURIComponent(setupSessionId)}?expand[]=setup_intent.payment_method`;
      const session = verifiedSetupSessionSchema.parse(await getJson(path));
      const fingerprint = session.setup_intent?.payment_method?.card?.fingerprint ?? null;

      if (
        session.mode !== "setup" ||
        session.status !== "complete" ||
        session.setup_intent?.status !== "succeeded" ||
        fingerprint === null
      ) {
        return null;
      }

      return {
        customerId: session.customer ?? null,
        fingerprint,
        userId: session.client_reference_id ?? null,
      };
    },
    createPortalSession: async (request: PortalSessionRequest) => {
      const form = new URLSearchParams({
        customer: request.customerId,
        return_url: request.returnUrl,
      });

      const session = portalSessionSchema.parse(
        await postForm("/v1/billing_portal/sessions", form),
      );

      return { id: session.id, url: session.url };
    },
    verifyWebhook,
  };

  return payments;
}
