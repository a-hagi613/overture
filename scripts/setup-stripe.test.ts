import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { runStripeSetup, stripeModeFor } from "./setup-stripe.ts";

import type { StripeRequest, StripeSetupOptions } from "./setup-stripe.ts";

interface StripeCall {
  body: string | null;
  method: string;
  url: string;
}

interface RecordedProduct {
  active: boolean;
  id: string;
  metadata: Record<string, string>;
  name: string;
  tax_code: string | null;
}

interface RecordedPrice {
  active: boolean;
  currency: string;
  id: string;
  lookup_key: string | null;
  product: string;
  recurring: { interval: string } | null;
  unit_amount: number;
}

interface RecordedEndpoint {
  enabled_events: string[];
  id: string;
  secret: string;
  status: string;
  url: string;
}

interface RecordedPortalProduct {
  prices: string[];
  product: string;
}

type ListedPrice =
  | RecordedPrice
  | (Omit<RecordedPrice, "product"> & { product: { active: boolean; id: string } });

interface RecordedPortal {
  active: boolean;
  business_profile: { privacy_policy_url: string | null; terms_of_service_url: string | null };
  default_return_url: string | null;
  features: {
    invoice_history: { enabled: boolean };
    payment_method_update: { enabled: boolean };
    subscription_cancel: { enabled: boolean; mode: string | null };
    subscription_update: {
      enabled: boolean;
      products: RecordedPortalProduct[];
      proration_behavior: string | null;
    };
  };
  id: string;
  is_default: boolean;
}

interface Failure {
  method: string;
  pathPrefix: string;
}

interface LogSink {
  lines: string[];
  write: (line: string) => void;
}

const tempDirectories: string[] = [];

function createLogSink() {
  const lines: string[] = [];

  return {
    lines,
    write: (line: string) => {
      lines.push(line);
    },
  };
}

function tempDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "overture-stripe-"));

  tempDirectories.push(directory);

  return directory;
}

function permissionBits(path: string) {
  return (statSync(path).mode % 0o1000).toString(8).padStart(3, "0");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function errorResponse(message: string, status: number) {
  return Response.json(
    { error: { message } },
    { headers: { "content-type": "application/json", "request-id": "req_test" }, status },
  );
}

function portalProductsFrom(form: URLSearchParams) {
  const products = new Map<string, RecordedPortalProduct>();

  for (const [key, value] of form.entries()) {
    const product =
      /^features\[subscription_update\]\[products\]\[(?<index>\d+)\]\[product\]$/u.exec(key);

    const index = product?.groups?.["index"];

    if (index !== undefined) {
      products.set(index, { prices: products.get(index)?.prices ?? [], product: value });
    }

    const price =
      /^features\[subscription_update\]\[products\]\[(?<index>\d+)\]\[prices\]\[0\]$/u.exec(key);

    const priceIndex = price?.groups?.["index"];

    if (priceIndex !== undefined) {
      const entry = products.get(priceIndex);

      if (entry !== undefined) {
        entry.prices.push(value);
      }
    }
  }

  return [...products.values()];
}

function portalFromForm(id: string, form: URLSearchParams, isDefault: boolean) {
  return {
    active: true,
    business_profile: {
      privacy_policy_url: form.get("business_profile[privacy_policy_url]"),
      terms_of_service_url: form.get("business_profile[terms_of_service_url]"),
    },
    default_return_url: form.get("default_return_url"),
    features: {
      invoice_history: { enabled: form.get("features[invoice_history][enabled]") === "true" },
      payment_method_update: {
        enabled: form.get("features[payment_method_update][enabled]") === "true",
      },
      subscription_cancel: {
        enabled: form.get("features[subscription_cancel][enabled]") === "true",
        mode: form.get("features[subscription_cancel][mode]"),
      },
      subscription_update: {
        enabled: form.get("features[subscription_update][enabled]") === "true",
        products: portalProductsFrom(form),
        proration_behavior: form.get("features[subscription_update][proration_behavior]"),
      },
    },
    id,
    is_default: isDefault,
  } satisfies RecordedPortal;
}

function createRecordedStripe() {
  const calls: StripeCall[] = [];
  const products: RecordedProduct[] = [];
  const prices: RecordedPrice[] = [];
  const endpoints: RecordedEndpoint[] = [];
  const portals: RecordedPortal[] = [];
  let failure: Failure | null = null;
  let sequence = 0;

  function nextId(prefix: string) {
    sequence += 1;

    return `${prefix}_${String(sequence)}`;
  }

  async function fetchStripe(url: string, request: StripeRequest) {
    await Promise.resolve();

    calls.push({ body: request.body, method: request.method, url });

    const parsed = new URL(url);
    const path = parsed.pathname;

    if (
      failure !== null &&
      request.method === failure.method &&
      path.startsWith(failure.pathPrefix)
    ) {
      return errorResponse("the recorded failure", 500);
    }

    if (request.method === "GET" && path === "/v1/prices") {
      const lookupKeys = parsed.searchParams.getAll("lookup_keys[]");
      const expandProduct = parsed.searchParams.getAll("expand[]").includes("data.product");

      const data: ListedPrice[] = [];

      for (const price of prices) {
        if (!lookupKeys.includes(price.lookup_key ?? "") || !price.active) {
          continue;
        }

        if (!expandProduct) {
          data.push(price);

          continue;
        }

        const owner = products.find((product) => product.id === price.product);

        data.push({
          active: price.active,
          currency: price.currency,
          id: price.id,
          lookup_key: price.lookup_key,
          product: { active: owner?.active ?? false, id: price.product },
          recurring: price.recurring,
          unit_amount: price.unit_amount,
        });
      }

      return Response.json({ data });
    }

    if (request.method === "POST" && path === "/v1/products") {
      const form = new URLSearchParams(request.body ?? "");

      const plan = form.get("metadata[overture_plan]");
      const metadata: Record<string, string> = {};

      if (plan !== null) {
        metadata["overture_plan"] = plan;
      }

      const product: RecordedProduct = {
        active: true,
        id: nextId("prod"),
        metadata,
        name: form.get("name") ?? "",
        tax_code: form.get("tax_code"),
      };

      products.push(product);

      return Response.json(product);
    }

    if (request.method === "POST" && path === "/v1/prices") {
      const form = new URLSearchParams(request.body ?? "");

      const interval = form.get("recurring[interval]");

      const lookupKey = form.get("lookup_key");

      if (form.get("transfer_lookup_key") === "true" && lookupKey !== null) {
        for (const entry of prices) {
          if (entry.lookup_key === lookupKey) {
            entry.lookup_key = null;
          }
        }
      }

      const price: RecordedPrice = {
        active: form.get("active") !== "false",
        currency: form.get("currency") ?? "",
        id: nextId("price"),
        lookup_key: lookupKey,
        product: form.get("product") ?? "",
        recurring: interval === null ? null : { interval },
        unit_amount: Number(form.get("unit_amount")),
      };

      prices.push(price);

      return Response.json(price);
    }

    if (request.method === "POST" && path.startsWith("/v1/prices/")) {
      const id = decodeURIComponent(path.slice("/v1/prices/".length));
      const price = prices.find((entry) => entry.id === id);
      const form = new URLSearchParams(request.body ?? "");

      if (price === undefined) {
        return errorResponse("missing", 404);
      }

      price.active = form.get("active") !== "false";

      return Response.json(price);
    }

    if (request.method === "GET" && path === "/v1/webhook_endpoints") {
      return Response.json({
        data: endpoints.map((endpoint) => ({
          enabled_events: endpoint.enabled_events,
          id: endpoint.id,
          status: endpoint.status,
          url: endpoint.url,
        })),
      });
    }

    if (request.method === "POST" && path === "/v1/webhook_endpoints") {
      const form = new URLSearchParams(request.body ?? "");

      const endpoint: RecordedEndpoint = {
        enabled_events: form.getAll("enabled_events[]"),
        id: nextId("we"),
        secret: `whsec_test_${String(sequence)}`,
        status: "enabled",
        url: form.get("url") ?? "",
      };

      endpoints.push(endpoint);

      return Response.json(endpoint);
    }

    if (request.method === "POST" && path.startsWith("/v1/webhook_endpoints/")) {
      const id = decodeURIComponent(path.slice("/v1/webhook_endpoints/".length));
      const endpoint = endpoints.find((entry) => entry.id === id);
      const form = new URLSearchParams(request.body ?? "");

      if (endpoint === undefined) {
        return errorResponse("missing", 404);
      }

      endpoint.enabled_events = form.getAll("enabled_events[]");
      endpoint.url = form.get("url") ?? endpoint.url;

      return Response.json(endpoint);
    }

    if (request.method === "DELETE" && path.startsWith("/v1/webhook_endpoints/")) {
      const id = decodeURIComponent(path.slice("/v1/webhook_endpoints/".length));
      const index = endpoints.findIndex((entry) => entry.id === id);

      if (index === -1) {
        return errorResponse("missing", 404);
      }

      endpoints.splice(index, 1);

      return Response.json({ deleted: true, id });
    }

    if (request.method === "GET" && path === "/v1/billing_portal/configurations") {
      return Response.json({ data: portals });
    }

    if (request.method === "POST" && path === "/v1/billing_portal/configurations") {
      const form = new URLSearchParams(request.body ?? "");
      const portal = portalFromForm(nextId("bpc"), form, portals.length === 0);

      portals.push(portal);

      return Response.json(portal);
    }

    if (request.method === "POST" && path.startsWith("/v1/billing_portal/configurations/")) {
      const id = decodeURIComponent(path.slice("/v1/billing_portal/configurations/".length));
      const form = new URLSearchParams(request.body ?? "");
      const existing = portals.find((entry) => entry.id === id);

      if (existing === undefined) {
        return errorResponse("missing", 404);
      }

      const updated = portalFromForm(id, form, existing.is_default);
      const index = portals.indexOf(existing);

      portals.splice(index, 1, updated);

      return Response.json(updated);
    }

    return errorResponse(`unhandled ${request.method} ${path}`, 404);
  }

  return {
    calls,
    endpoints,
    failOn(method: string, pathPrefix: string) {
      failure = { method, pathPrefix };
    },
    fetchStripe,
    portals,
    prices,
    products,
  };
}

function optionsFor(
  fake: ReturnType<typeof createRecordedStripe>,
  sink: LogSink,
  extra: {
    outEnvPath?: string | null;
    reconcilePrices?: boolean;
    rotateWebhook?: boolean;
  } = {},
) {
  return {
    apiBaseUrl: "https://api.stripe.test",
    appOrigin: "https://tryoverture.com",
    fetch: fake.fetchStripe,
    log: sink.write,
    outEnvPath: extra.outEnvPath ?? null,
    reconcilePrices: extra.reconcilePrices ?? false,
    rotateWebhook: extra.rotateWebhook ?? false,
    secretKey: "sk_test_recorded",
  } satisfies StripeSetupOptions;
}

test("a first run creates both plans, the webhook and the portal configuration", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  const result = await runStripeSetup(optionsFor(fake, sink));

  expect(result.mode).toBe("test");
  expect(fake.products.map((product) => product.name)).toStrictEqual([
    "Overture Week",
    "Overture Month",
  ]);
  expect(fake.prices.map((price) => price.unit_amount)).toStrictEqual([999, 2999]);
  expect(fake.prices.map((price) => price.recurring?.interval)).toStrictEqual(["week", "month"]);
  expect(fake.prices.map((price) => price.lookup_key)).toStrictEqual([
    "overture_week_usd",
    "overture_month_usd",
  ]);
  expect(fake.prices.map((price) => price.currency)).toStrictEqual(["usd", "usd"]);
  expect(fake.products.map((product) => product.tax_code)).toStrictEqual([
    "txcd_10103000",
    "txcd_10103000",
  ]);
  expect(fake.endpoints).toHaveLength(1);
  expect(fake.endpoints[0]?.url).toBe("https://tryoverture.com/api/webhooks/stripe");
  expect(fake.endpoints[0]?.enabled_events).toHaveLength(9);
  expect(fake.endpoints[0]?.enabled_events).toContain("invoice.paid");
  expect(fake.endpoints[0]?.enabled_events).toContain("customer.subscription.updated");
  expect(fake.portals).toHaveLength(1);
  expect(fake.portals[0]?.is_default).toBe(true);
  expect(fake.portals[0]?.features.subscription_cancel).toStrictEqual({
    enabled: true,
    mode: "at_period_end",
  });
  expect(fake.portals[0]?.features.invoice_history.enabled).toBe(true);
  expect(fake.portals[0]?.features.payment_method_update.enabled).toBe(true);
  expect(fake.portals[0]?.features.subscription_update.enabled).toBe(true);
  expect(fake.portals[0]?.features.subscription_update.products).toStrictEqual([
    { prices: [result.priceIds.week], product: fake.prices[0]?.product ?? "" },
    { prices: [result.priceIds.month], product: fake.prices[1]?.product ?? "" },
  ]);
  expect(result.webhook.secret).toBe(fake.endpoints[0]?.secret ?? null);
  expect(result.webhook.rotated).toBe(false);
});

test("the portal configuration uses the documented Stripe form keys", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();
  const result = await runStripeSetup(optionsFor(fake, sink));

  const createCall = fake.calls.find(
    (call) =>
      call.method === "POST" &&
      call.url === "https://api.stripe.test/v1/billing_portal/configurations",
  );

  if (createCall === undefined) {
    throw new Error("the first run posted no portal configuration");
  }

  const form = new URLSearchParams(createCall.body ?? "");

  expect(form.get("features[subscription_update][products][0][prices][0]")).toBe(
    result.priceIds.week,
  );
  expect(form.get("features[subscription_update][products][1][prices][0]")).toBe(
    result.priceIds.month,
  );
  expect(form.has("features[subscription_update][products][0][prices][0][price]")).toBe(false);
  expect(form.get("features[subscription_update][proration_behavior]")).toBe("none");
  expect(form.get("default_return_url")).toBe("https://tryoverture.com/settings/billing");
  expect(form.get("business_profile[privacy_policy_url]")).toBe("https://tryoverture.com/privacy");
  expect(form.get("business_profile[terms_of_service_url]")).toBe("https://tryoverture.com/terms");
});

test("a second run reuses both prices, the webhook and the portal without duplicating anything", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  await runStripeSetup(optionsFor(fake, sink));

  const callsAfterFirstRun = fake.calls.length;
  const endpointId = fake.endpoints[0]?.id ?? "";
  const result = await runStripeSetup(optionsFor(fake, sink));
  const secondRunCalls = fake.calls.slice(callsAfterFirstRun);

  expect(fake.products).toHaveLength(2);
  expect(fake.prices).toHaveLength(2);
  expect(fake.endpoints).toHaveLength(1);
  expect(fake.portals).toHaveLength(1);
  expect(result.webhook.secret).toBeNull();
  expect(result.webhook.rotated).toBe(false);
  expect(secondRunCalls.filter((call) => call.method === "POST")).toHaveLength(0);
  expect(fake.calls.filter((call) => call.method === "POST")).toHaveLength(6);
  expect(sink.lines).toContain(
    `Webhook endpoint ${endpointId} already listens to all nine events; its signing secret was not rotated.`,
  );
});

test("--rotate-webhook replaces the endpoint and returns a new signing secret", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();
  const first = await runStripeSetup(optionsFor(fake, sink));
  const firstEndpointId = fake.endpoints[0]?.id ?? "";
  const second = await runStripeSetup(optionsFor(fake, sink, { rotateWebhook: true }));

  expect(first.webhook.secret).toStartWith("whsec_test_");
  expect(second.webhook.secret).toStartWith("whsec_test_");
  expect(second.webhook.secret).not.toBe(first.webhook.secret);
  expect(second.webhook.rotated).toBe(true);
  expect(fake.endpoints).toHaveLength(1);
  expect(fake.endpoints[0]?.id).not.toBe(firstEndpointId);
  expect(fake.calls.some((call) => call.method === "DELETE")).toBe(true);
});

test("an endpoint with the wrong events is updated without rotating its secret", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  await runStripeSetup(optionsFor(fake, sink));

  const [endpoint] = fake.endpoints;

  if (endpoint === undefined) {
    throw new Error("the first run created no webhook endpoint");
  }

  endpoint.enabled_events = ["invoice.paid"];

  const result = await runStripeSetup(optionsFor(fake, sink));

  expect(result.webhook.secret).toBeNull();
  expect(result.webhook.rotated).toBe(false);
  expect(endpoint.enabled_events).toHaveLength(9);
  expect(
    fake.calls.some(
      (call) => call.method === "POST" && call.url.endsWith(`/v1/webhook_endpoints/${endpoint.id}`),
    ),
  ).toBe(true);
  expect(fake.calls.some((call) => call.method === "DELETE")).toBe(false);
});

test("a disabled endpoint for the same url is ignored and a new enabled one is created", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  await runStripeSetup(optionsFor(fake, sink));

  const [endpoint] = fake.endpoints;

  if (endpoint === undefined) {
    throw new Error("the first run created no webhook endpoint");
  }

  endpoint.status = "disabled";

  const result = await runStripeSetup(optionsFor(fake, sink));

  expect(result.webhook.secret).toStartWith("whsec_test_");
  expect(fake.endpoints).toHaveLength(2);
  expect(fake.endpoints.filter((entry) => entry.status === "enabled")).toHaveLength(1);
  expect(fake.calls.some((call) => call.method === "DELETE")).toBe(false);
});

test("a portal configuration with the wrong cancellation mode is updated in place", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  await runStripeSetup(optionsFor(fake, sink));

  const [portal] = fake.portals;

  if (portal === undefined) {
    throw new Error("the first run created no portal configuration");
  }

  portal.features.subscription_cancel.mode = "immediately";

  const result = await runStripeSetup(optionsFor(fake, sink));

  expect(fake.portals).toHaveLength(1);
  expect(fake.portals[0]?.features.subscription_cancel.mode).toBe("at_period_end");
  expect(result.portalConfigurationId).toBe(portal.id);
  expect(
    fake.calls.some(
      (call) =>
        call.method === "POST" &&
        call.url.endsWith(`/v1/billing_portal/configurations/${portal.id}`),
    ),
  ).toBe(true);
});

test("a lookup-key price on an inactive product is refused instead of duplicated", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  await runStripeSetup(optionsFor(fake, sink));

  const [product] = fake.products;

  if (product === undefined) {
    throw new Error("the first run created no product");
  }

  product.active = false;

  let failure: Error | null = null;

  try {
    await runStripeSetup(optionsFor(fake, sink, { reconcilePrices: true }));
  } catch (error) {
    failure = z.instanceof(Error).parse(error);
  }

  expect(failure?.message).toContain("inactive product");
  expect(fake.products).toHaveLength(2);
  expect(fake.prices).toHaveLength(2);
});

test("a lookup-key price with a different amount is refused instead of duplicated", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  await runStripeSetup(optionsFor(fake, sink));

  const [price] = fake.prices;

  if (price === undefined) {
    throw new Error("the first run created no price");
  }

  price.unit_amount = 1200;

  let failure: Error | null = null;

  try {
    await runStripeSetup(optionsFor(fake, sink));
  } catch (error) {
    failure = z.instanceof(Error).parse(error);
  }

  expect(failure?.message).toContain("reconcile that price in Stripe before re-running");
  expect(failure?.message).toContain("--reconcile-prices");
  expect(fake.products).toHaveLength(2);
  expect(fake.prices).toHaveLength(2);
});

test("--reconcile-prices replaces drifted prices on the existing products and updates the portal", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  await runStripeSetup(optionsFor(fake, sink));

  const [weekPrice, monthPrice] = fake.prices;

  if (weekPrice === undefined || monthPrice === undefined) {
    throw new Error("the first run created fewer than two prices");
  }

  weekPrice.unit_amount = 1200;
  monthPrice.unit_amount = 3500;

  const path = join(tempDirectory(), "stripe-setup.env");

  const result = await runStripeSetup(
    optionsFor(fake, sink, { outEnvPath: path, reconcilePrices: true }),
  );

  const replacementCalls = fake.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.url === "https://api.stripe.test/v1/prices" &&
      new URLSearchParams(call.body ?? "").get("transfer_lookup_key") === "true",
  );

  const activePrices = fake.prices.filter((price) => price.active);
  const contents = readFileSync(path, "utf8");

  expect(fake.products).toHaveLength(2);
  expect(weekPrice.active).toBe(false);
  expect(monthPrice.active).toBe(false);
  expect(activePrices).toHaveLength(2);
  expect(
    activePrices.map((price) => price.unit_amount).toSorted((left, right) => left - right),
  ).toStrictEqual([999, 2999]);
  expect(replacementCalls).toHaveLength(2);
  expect(result.priceIds.week).not.toBe(weekPrice.id);
  expect(result.priceIds.month).not.toBe(monthPrice.id);
  expect(fake.portals[0]?.features.subscription_update.products).toStrictEqual([
    { prices: [result.priceIds.week], product: weekPrice.product },
    { prices: [result.priceIds.month], product: monthPrice.product },
  ]);
  expect(contents).toContain(`STRIPE_PRICE_WEEK=${result.priceIds.week}`);
  expect(contents).toContain(`STRIPE_PRICE_MONTH=${result.priceIds.month}`);
  expect(sink.lines).toContain(
    `Replaced drifted week price ${weekPrice.id} with ${result.priceIds.week} (overture_week_usd) and archived ${weekPrice.id}.`,
  );
});

test("--out-env writes the public ids and the webhook secret to a 0600 file, and no secret reaches the logs", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();
  const path = join(tempDirectory(), "stripe-setup.env");
  const result = await runStripeSetup(optionsFor(fake, sink, { outEnvPath: path }));
  const contents = readFileSync(path, "utf8");
  const output = sink.lines.join("\n");

  expect(permissionBits(path)).toBe("600");
  expect(contents).toContain(`STRIPE_PRICE_WEEK=${result.priceIds.week}`);
  expect(contents).toContain(`STRIPE_PRICE_MONTH=${result.priceIds.month}`);
  expect(contents).toContain(`STRIPE_WEBHOOK_SECRET=${result.webhook.secret ?? ""}`);
  expect(result.webhook.secret).toStartWith("whsec_test_");
  expect(contents).not.toContain("sk_test_recorded");
  expect(output).not.toContain("sk_test_recorded");
  expect(output).not.toContain(result.webhook.secret ?? "");
  expect(output).not.toContain("whsec_");
  expect(output).toContain(result.priceIds.week);
  expect(output).toContain(result.priceIds.month);
});

test("an env file for an already existing webhook carries no webhook secret", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();

  await runStripeSetup(optionsFor(fake, sink));

  const path = join(tempDirectory(), "stripe-setup.env");

  await runStripeSetup(optionsFor(fake, sink, { outEnvPath: path }));

  const contents = readFileSync(path, "utf8");

  expect(contents).toContain("STRIPE_PRICE_WEEK=");
  expect(contents).toContain("STRIPE_PRICE_MONTH=");
  expect(contents).not.toContain("STRIPE_WEBHOOK_SECRET=");
});

test("both secret and restricted keys from both modes are accepted", () => {
  expect(stripeModeFor("sk_test_fixture")).toBe("test");
  expect(stripeModeFor("rk_test_fixture")).toBe("test");
  expect(stripeModeFor("sk_live_fixture")).toBe("live");
  expect(stripeModeFor("rk_live_fixture")).toBe("live");
});

test("an unrecognised key prefix is refused before any Stripe request", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();
  let failure: Error | null = null;

  try {
    await runStripeSetup({ ...optionsFor(fake, sink), secretKey: "pk_test_not_a_secret" });
  } catch (error) {
    failure = z.instanceof(Error).parse(error);
  }

  expect(failure?.message).toContain("sk_test_");
  expect(fake.calls).toHaveLength(0);
});

test("a Stripe HTTP error fails loudly without writing the env file", async () => {
  const fake = createRecordedStripe();
  const sink = createLogSink();
  const path = join(tempDirectory(), "stripe-setup.env");

  fake.failOn("POST", "/v1/products");

  let failure: Error | null = null;

  try {
    await runStripeSetup(optionsFor(fake, sink, { outEnvPath: path }));
  } catch (error) {
    failure = z.instanceof(Error).parse(error);
  }

  expect(failure?.message).toBe("Stripe POST /v1/products failed with 500 (request req_test)");
  expect(existsSync(path)).toBe(false);
});
