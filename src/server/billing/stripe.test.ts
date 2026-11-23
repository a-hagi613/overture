import { describe, expect, test } from "bun:test";

import { createStripePayments } from "./stripe.ts";

const WEBHOOK_SECRET = "whsec_test";
const EVENT_TIME_SECONDS = 1_795_270_000;
const WEEK_PRICE = "price_week";
const MONTH_PRICE = "price_month";

function payments(planPriceIds?: readonly string[]) {
  const config = {
    apiBaseUrl: "http://127.0.0.1:9",
    clock: { now: () => EVENT_TIME_SECONDS * 1000 },
    secretKey: "sk_test",
    webhookSecret: WEBHOOK_SECRET,
  };

  if (planPriceIds !== undefined) {
    return createStripePayments({ ...config, planPriceIds });
  }

  return createStripePayments(config);
}

async function signed(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );

  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${EVENT_TIME_SECONDS}.${body}`),
    ),
  );

  const signature = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return { body, header: `t=${EVENT_TIME_SECONDS},v1=${signature}` };
}

function invoicePayload(input: {
  amount: number;
  id: string;
  priceId: string;
  proration?: boolean;
  periodEnd: number;
}) {
  return {
    amount: input.amount,
    current_period_end: input.periodEnd,
    id: input.id,
    object: "line_item",
    period: { end: input.periodEnd, start: EVENT_TIME_SECONDS },
    proration: input.proration ?? false,
    pricing: { price_details: { price: input.priceId }, type: "price_details" },
  };
}

function event<T extends object>(type: string, object: T) {
  return {
    api_version: "2025-10-29.clover",
    created: EVENT_TIME_SECONDS,
    data: { object },
    id: "evt_test",
    livemode: false,
    object: "event",
    type,
  };
}

describe("the Stripe webhook adapter", () => {
  test("reads the subscription from parent.subscription_details on a basil invoice", async () => {
    const payload = event("invoice.paid", {
      amount_paid: 3500,
      customer: "cus_1",
      id: "in_1",
      lines: {
        data: [
          invoicePayload({
            amount: 3500,
            id: "il_1",
            periodEnd: 1_800_000_000,
            priceId: MONTH_PRICE,
          }),
        ],
      },
      metadata: {},
      object: "invoice",
      parent: {
        subscription_details: {
          metadata: { plan: "month", user_id: "user-1" },
          subscription: "sub_parent",
        },
        type: "subscription_details",
      },
      status: "paid",
    });

    const { body, header } = await signed(JSON.stringify(payload));
    const parsed = await payments().verifyWebhook(body, header);

    expect(parsed.subscriptionId).toBe("sub_parent");
    expect(parsed.priceId).toBe(MONTH_PRICE);
    expect(parsed.eventCreatedAt).toBe(EVENT_TIME_SECONDS * 1000);
  });

  test("picks the new plan's line on a Week to Month proration invoice", async () => {
    const payload = event("invoice.paid", {
      customer: "cus_1",
      id: "in_upgrade",
      lines: {
        data: [
          invoicePayload({
            amount: -1200,
            id: "il_week_credit",
            periodEnd: 1_799_000_000,
            priceId: WEEK_PRICE,
            proration: true,
          }),
          invoicePayload({
            amount: 3500,
            id: "il_month_charge",
            periodEnd: 1_800_000_000,
            priceId: MONTH_PRICE,
            proration: true,
          }),
        ],
      },
      metadata: {},
      object: "invoice",
      subscription: "sub_1",
      status: "paid",
    });

    const { body, header } = await signed(JSON.stringify(payload));
    const parsed = await payments([WEEK_PRICE, MONTH_PRICE]).verifyWebhook(body, header);

    expect(parsed.priceId).toBe(MONTH_PRICE);
    expect(parsed.periodEndMs).toBe(1_800_000_000 * 1000);
  });

  test("a subscription event is not treated as a customer event", async () => {
    const payload = event("customer.subscription.updated", {
      cancel_at_period_end: false,
      current_period_end: 1_800_000_000,
      current_period_start: EVENT_TIME_SECONDS,
      id: "sub_1",
      items: {
        data: [
          {
            current_period_end: 1_800_000_000,
            current_period_start: EVENT_TIME_SECONDS,
            price: { id: MONTH_PRICE },
          },
        ],
      },
      metadata: { plan: "month", user_id: "user-1" },
      object: "subscription",
      status: "active",
    });

    const { body, header } = await signed(JSON.stringify(payload));
    const parsed = await payments().verifyWebhook(body, header);

    expect(parsed.customerId).toBeNull();
    expect(parsed.subscriptionId).toBe("sub_1");
    expect(parsed.subscriptionStatus).toBe("active");
  });
});
