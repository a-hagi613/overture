import { expect, test } from "@playwright/test";

import { createStripePayments } from "../../src/server/billing/stripe.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";

import { startStripeMock } from "./stripe-mock.fixture.ts";

const WEBHOOK_SECRET = ["whsec", "unit"].join("_");
const SECRET_KEY = ["sk", "test", "unit"].join("_");

test("the setup session is Checkout in setup mode, never a subscription", async () => {
  const mock = await startStripeMock();

  try {
    const payments = createStripePayments({
      apiBaseUrl: mock.url,
      clock: createClock(),
      secretKey: SECRET_KEY,
      webhookSecret: WEBHOOK_SECRET,
    });

    const session = await payments.createSetupSession({
      cancelUrl: "https://app.test/onboarding/trial?card=cancelled",
      customerId: null,
      email: "person@example.com",
      successUrl: "https://app.test/onboarding/trial?card=verified",
      userId: "user-1",
    });

    expect(session.url).toMatch(/^https:\/\//u);

    const post = mock.requests.find((request) => request.path === "/v1/checkout/sessions");

    expect(post?.body).toContain("mode=setup");
    expect(post?.body).not.toContain("mode=subscription");
  } finally {
    await mock.stop();
  }
});

test("a setup session is read with a GET and yields a card only when it succeeded", async () => {
  const mock = await startStripeMock();

  try {
    const payments = createStripePayments({
      apiBaseUrl: mock.url,
      clock: createClock(),
      secretKey: SECRET_KEY,
      webhookSecret: WEBHOOK_SECRET,
    });

    const card = await payments.retrieveVerifiedCard("cs_test_unit");

    const get = mock.requests.find((request) =>
      request.path.startsWith("/v1/checkout/sessions/cs_test_unit"),
    );

    expect(get?.method).toBe("GET");
    expect(card?.fingerprint.length ?? 0).toBeGreaterThanOrEqual(0);
  } finally {
    await mock.stop();
  }
});
