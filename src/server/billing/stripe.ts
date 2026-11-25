import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { Clock } from "../platform/ports/clock.ts";
import type {
  BillingWindow,
  CheckoutSessionRequest,
  PaymentEvent,
  Payments,
  PortalSessionRequest,
  RefundRequest,
  SetupSessionRequest,
} from "../platform/ports/payments.ts";

import {
  InvalidWebhookSignatureError,
  NoRefundablePaymentError,
} from "../platform/ports/payments.ts";

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

const invoicePaymentsSchema = z.object({
  data: z.array(
    z.object({
      payment: z
        .object({
          payment_intent: z
            .object({ id: z.string().min(1) })
            .nullable()
            .optional(),
          type: z.string(),
        })
        .nullable()
        .optional(),
    }),
  ),
});

const refundSchema = z.object({
  id: z.string().min(1),
  status: z.string().nullable(),
  amount: z.number().int().nonnegative(),
});

const invoiceListSchema = z.object({
  data: z.array(
    z.object({
      amount_paid: z.number().int().nonnegative(),
      created: z.number().int(),
      customer: z.string().nullable().optional(),
      id: z.string().min(1),
      status: z.string().optional(),
      status_transitions: z
        .object({ paid_at: z.number().int().nullable().optional() })
        .nullable()
        .optional(),
    }),
  ),
  has_more: z.boolean(),
});

const refundListSchema = z.object({
  data: z.array(
    z.object({
      amount: z.number().int().nonnegative(),
      created: z.number().int(),
      id: z.string().min(1),
    }),
  ),
  has_more: z.boolean(),
});

const LIST_PAGE_SIZE = 100;
const LIST_PAGE_LIMIT = 50;

type StripePageCollector = <T extends { id: string }>(
  path: string,
  form: URLSearchParams,
  pageSchema: z.ZodType<{ data: T[]; has_more: boolean }>,
  startingAfter: string | null,
  page: number,
) => Promise<T[]>;

function windowForm(window: BillingWindow, extra?: Record<string, string>) {
  return new URLSearchParams({
    "created[gte]": String(Math.trunc(window.sinceMs / 1000)),
    "created[lte]": String(Math.trunc(window.untilMs / 1000)),
    ...extra,
  });
}

const metadataSchema = z.object({
  plan: z.string().optional(),
  user_id: z.string().optional(),
});

const planNames = ["month", "week"] as const;

function planOf(value: string | undefined) {
  return planNames.find((plan) => plan === value) ?? null;
}

function nonEmpty(value: string | null | undefined) {
  return value === undefined || value === null || value === "" ? null : value;
}

const lineSchema = z.object({
  amount: z.number().optional(),
  current_period_end: z.number().optional(),
  current_period_start: z.number().optional(),
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
  proration: z.boolean().nullable().optional(),
});

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number().int().optional(),
  data: z.object({
    object: z.object({
      id: z.string().optional(),
      cancel_at_period_end: z.boolean().optional(),
      client_reference_id: z.string().nullable().optional(),
      current_period_end: z.number().optional(),
      current_period_start: z.number().optional(),
      customer: z.string().nullable().optional(),
      mode: z.string().nullable().optional(),
      items: z
        .object({ data: z.array(lineSchema).optional() })
        .nullable()
        .optional(),
      lines: z
        .object({ data: z.array(lineSchema).optional() })
        .nullable()
        .optional(),
      metadata: metadataSchema.nullable().optional(),
      parent: z
        .object({
          subscription_details: z
            .object({
              metadata: metadataSchema.nullable().optional(),
              subscription: z
                .union([z.string(), z.object({ id: z.string() }).transform((named) => named.id)])
                .nullable()
                .optional(),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
      status: z.string().max(64).optional(),
      subscription: z
        .union([z.string(), z.object({ id: z.string() }).transform((named) => named.id)])
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

function lineEnd(line: z.infer<typeof lineSchema>) {
  return line.period?.end ?? line.current_period_end ?? 0;
}

function planLineOf(lines: readonly z.infer<typeof lineSchema>[], planPriceIds: readonly string[]) {
  const priced = lines.filter((line) => priceIdOf(line) !== null);
  const [firstPriced] = priced;

  if (firstPriced === undefined) {
    return null;
  }

  const configured = priced.filter((line) => {
    const priceId = priceIdOf(line);

    return priceId !== null && planPriceIds.includes(priceId);
  });

  const billable = priced.filter((line) => line.proration !== true && (line.amount ?? 0) > 0);
  const configuredFirst = configured.length > 0 ? configured : billable;
  const pool = configuredFirst.length > 0 ? configuredFirst : priced;
  const [head] = pool;

  if (head === undefined) {
    return null;
  }

  let best = head;

  for (const line of pool) {
    if (lineEnd(line) > lineEnd(best)) {
      best = line;
    }
  }

  return best;
}

function subscriptionIdOf(object: z.infer<typeof eventSchema>["data"]["object"], type: string) {
  return (
    nonEmpty(object.subscription) ??
    nonEmpty(object.parent?.subscription_details?.subscription) ??
    (type.startsWith("customer.subscription.") ? (object.id ?? null) : null)
  );
}

function eventFrom(parsed: z.infer<typeof eventSchema>, planPriceIds: readonly string[]) {
  const { object } = parsed.data;
  const subscriptionEvent = parsed.type.startsWith("customer.subscription.");

  const subscriptionMetadata =
    object.parent?.subscription_details?.metadata ?? object.subscription_details?.metadata ?? null;

  const userId = nonEmpty(
    object.client_reference_id ?? subscriptionMetadata?.user_id ?? object.metadata?.user_id,
  );

  const customerEvent =
    parsed.type === "customer.created" ||
    parsed.type === "customer.updated" ||
    parsed.type === "customer.deleted";

  const customerId = object.customer ?? (customerEvent ? object.id : null);
  const lines = [...(object.lines?.data ?? []), ...(object.items?.data ?? [])];
  let periodEndSeconds = subscriptionEvent ? (object.current_period_end ?? 0) : 0;
  let periodStartSeconds = subscriptionEvent ? (object.current_period_start ?? 0) : 0;

  for (const line of lines) {
    periodEndSeconds = Math.max(
      periodEndSeconds,
      line.period?.end ?? 0,
      line.current_period_end ?? 0,
    );
    periodStartSeconds = Math.max(
      periodStartSeconds,
      line.period?.start ?? 0,
      line.current_period_start ?? 0,
    );
  }

  const planLine = planLineOf(lines, planPriceIds);

  const isSession = parsed.type.startsWith("checkout.session.");

  const event: PaymentEvent = {
    cancelAtPeriodEnd: subscriptionEvent ? (object.cancel_at_period_end ?? false) : null,
    customerId: customerId ?? null,
    eventCreatedAt: parsed.created === undefined ? null : parsed.created * 1000,
    id: parsed.id,
    invoiceId: parsed.type.startsWith("invoice.") ? (object.id ?? null) : null,
    periodEndMs: periodEndSeconds > 0 ? periodEndSeconds * 1000 : null,
    periodStartMs: periodStartSeconds > 0 ? periodStartSeconds * 1000 : null,
    plan: planOf(object.metadata?.plan) ?? planOf(subscriptionMetadata?.plan),
    priceId: planLine === null ? null : priceIdOf(planLine),
    mode: object.mode ?? null,
    sessionId: isSession ? (object.id ?? null) : null,
    subscriptionId: subscriptionIdOf(object, parsed.type),
    subscriptionStatus: subscriptionEvent ? (object.status ?? null) : null,
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
  /** The Stripe price ids Overture sells, so an invoice's plan line wins over a proration credit. */
  planPriceIds?: readonly string[];
}

export function createStripePayments(config: StripePaymentsConfig) {
  const apiBaseUrl = config.apiBaseUrl.replace(/\/+$/u, "");
  const toleranceSeconds = config.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;

  async function postForm(path: string, form: URLSearchParams, idempotencyKey?: string) {
    const headers = new Headers({
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    });

    if (idempotencyKey !== undefined) {
      headers.set("idempotency-key", idempotencyKey);
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers,
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

  const collectPages: StripePageCollector = async (path, form, pageSchema, startingAfter, page) => {
    if (page >= LIST_PAGE_LIMIT) {
      throw new Error(
        `Stripe ${path} returned more than ${String(LIST_PAGE_LIMIT)} pages for one window.`,
      );
    }

    const params = new URLSearchParams(form);

    params.set("limit", String(LIST_PAGE_SIZE));

    if (startingAfter !== null) {
      params.set("starting_after", startingAfter);
    }

    const parsed = pageSchema.parse(await getJson(`${path}?${params.toString()}`));
    const last = parsed.data.at(-1);

    if (!parsed.has_more || last === undefined) {
      return parsed.data;
    }

    return [...parsed.data, ...(await collectPages(path, form, pageSchema, last.id, page + 1))];
  };

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

    return eventFrom(parsed.data, config.planPriceIds ?? []);
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

      const session = checkoutSessionSchema.parse(
        await postForm("/v1/checkout/sessions", form, request.idempotencyKey),
      );

      return { id: session.id, url: session.url };
    },
    createSetupSession: async (request: SetupSessionRequest) => {
      const form = new URLSearchParams({
        client_reference_id: request.userId,
        // Checkout needs a currency to select payment methods in setup mode.
        currency: "usd",
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
    refundInvoice: async (request: RefundRequest) => {
      const invoicePayments = invoicePaymentsSchema.parse(
        await getJson(
          `/v1/invoice_payments?${new URLSearchParams({
            invoice: request.invoiceId,
            "expand[]": "data.payment.payment_intent",
          }).toString()}`,
        ),
      );

      const paymentIntent = invoicePayments.data
        .map((row) => row.payment)
        .find((payment) => payment?.type === "payment_intent")?.payment_intent;

      if (paymentIntent === null || paymentIntent === undefined) {
        throw new NoRefundablePaymentError();
      }

      const form = new URLSearchParams({ payment_intent: paymentIntent.id });

      if (request.amountCents !== null) {
        form.set("amount", String(request.amountCents));
      }

      const refund = refundSchema.parse(
        await postForm("/v1/refunds", form, request.idempotencyKey),
      );

      return { amountCents: refund.amount, id: refund.id, status: refund.status ?? "unknown" };
    },
    listPaidInvoices: async (window: BillingWindow) => {
      const rows = await collectPages(
        "/v1/invoices",
        windowForm(window, { status: "paid" }),
        invoiceListSchema,
        null,
        0,
      );

      return rows
        .filter((row) => row.status === "paid")
        .map((row) => ({
          amountPaidCents: row.amount_paid,
          customerId: row.customer ?? null,
          invoiceId: row.id,
          paidAtMs: (row.status_transitions?.paid_at ?? row.created) * 1000,
        }));
    },
    listRefunds: async (window: BillingWindow) => {
      const rows = await collectPages("/v1/refunds", windowForm(window), refundListSchema, null, 0);

      return rows.map((row) => ({
        amountCents: row.amount,
        createdAtMs: row.created * 1000,
        refundId: row.id,
      }));
    },
    verifyWebhook,
  };

  return payments;
}
