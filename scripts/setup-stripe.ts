import { chmodSync, writeFileSync } from "node:fs";

import { z } from "zod";

import type { BillingPlan } from "../src/server/platform/ports/payments.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_APP_ORIGIN = "https://tryoverture.com";

export const WEBHOOK_EVENTS = [
  "checkout.session.async_payment_succeeded",
  "checkout.session.completed",
  "customer.created",
  "customer.updated",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.deleted",
  "customer.subscription.updated",
] as const;

export type StripeMode = "live" | "test";

export interface StripeRequest {
  method: "DELETE" | "GET" | "POST";
  headers: Record<string, string>;
  body: string | null;
  signal: AbortSignal;
}

export type StripeFetcher = (url: string, request: StripeRequest) => Promise<Response>;

export interface StripeSetupOptions {
  secretKey: string;
  appOrigin: string;
  apiBaseUrl: string;
  reconcilePrices: boolean;
  rotateWebhook: boolean;
  outEnvPath: string | null;
  fetch: StripeFetcher;
  log: (line: string) => void;
}

export interface StripeSetupResult {
  mode: StripeMode;
  portalConfigurationId: string;
  priceIds: Record<BillingPlan, string>;
  webhook: { id: string; rotated: boolean; secret: string | null };
}

interface StripeClientOptions {
  apiBaseUrl: string;
  fetch: StripeFetcher;
  secretKey: string;
}

interface PlanSpec {
  interval: "month" | "week";
  lookupKey: string;
  plan: BillingPlan;
  productName: string;
  unitAmount: number;
}

interface PlanIds {
  plan: BillingPlan;
  priceId: string;
  productId: string;
}

const WEEK_SPEC: PlanSpec = {
  interval: "week",
  lookupKey: "overture_week_usd",
  plan: "week",
  productName: "Overture Week",
  unitAmount: 999,
};

const MONTH_SPEC: PlanSpec = {
  interval: "month",
  lookupKey: "overture_month_usd",
  plan: "month",
  productName: "Overture Month",
  unitAmount: 2999,
};

const productReferenceSchema = z.union([
  z
    .string()
    .min(1)
    .transform((id) => ({ active: true, id })),
  z.object({ active: z.boolean().default(true), id: z.string().min(1) }),
]);

const priceSchema = z.object({
  active: z.boolean(),
  currency: z.string(),
  id: z.string().min(1),
  lookup_key: z.string().nullable().optional(),
  product: productReferenceSchema,
  recurring: z.object({ interval: z.string() }).nullable().optional(),
  unit_amount: z.number().int().nonnegative().nullable(),
});

const priceListSchema = z.object({ data: z.array(priceSchema) });

const createdProductSchema = z.object({ id: z.string().min(1) });

const createdPriceSchema = z.object({ id: z.string().min(1) });

const webhookEndpointSchema = z.object({
  enabled_events: z.array(z.string()),
  id: z.string().min(1),
  secret: z.string().min(1).optional(),
  status: z.string().optional(),
  url: z.string().min(1),
});

const webhookListSchema = z.object({ data: z.array(webhookEndpointSchema) });

const deletedWebhookSchema = z.object({ id: z.string().min(1) });

const portalConfigurationSchema = z.object({
  active: z.boolean(),
  business_profile: z
    .object({
      privacy_policy_url: z.string().nullable().optional(),
      terms_of_service_url: z.string().nullable().optional(),
    })
    .default({}),
  default_return_url: z.string().nullable().optional(),
  features: z.object({
    invoice_history: z.object({ enabled: z.boolean() }),
    payment_method_update: z.object({ enabled: z.boolean() }),
    subscription_cancel: z.object({
      enabled: z.boolean(),
      mode: z.string().nullable().optional(),
    }),
    subscription_update: z.object({
      enabled: z.boolean(),
      products: z
        .array(z.object({ prices: z.array(z.string()), product: z.string() }))
        .nullable()
        .optional(),
      proration_behavior: z.string().nullable().optional(),
    }),
  }),
  id: z.string().min(1),
  is_default: z.boolean(),
});

const portalListSchema = z.object({ data: z.array(portalConfigurationSchema) });

export function stripeModeFor(secretKey: string) {
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) {
    return "test";
  }

  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    return "live";
  }

  throw new Error(
    "STRIPE_SECRET_KEY must begin with sk_test_, rk_test_, sk_live_ or rk_live_; refusing to contact Stripe with an unrecognised key.",
  );
}

function pathWithoutQuery(path: string) {
  const index = path.indexOf("?");

  return index === -1 ? path : path.slice(0, index);
}

async function requestJson<T>(
  options: StripeClientOptions,
  method: StripeRequest["method"],
  path: string,
  schema: z.ZodType<T>,
  form: URLSearchParams | null,
) {
  const authorization = `Bearer ${options.secretKey}`;

  const headers =
    form === null
      ? { authorization }
      : { authorization, "content-type": "application/x-www-form-urlencoded" };

  const response = await options.fetch(`${options.apiBaseUrl}${path}`, {
    body: form === null ? null : form.toString(),
    headers,
    method,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const requestId = response.headers.get("request-id") ?? "unknown";

    throw new Error(
      `Stripe ${method} ${pathWithoutQuery(path)} failed with ${String(response.status)} (request ${requestId})`,
    );
  }

  const payload: unknown = await response.json();

  return schema.parse(payload);
}

function priceMatches(price: z.infer<typeof priceSchema>, spec: PlanSpec) {
  return (
    price.unit_amount === spec.unitAmount &&
    price.currency === "usd" &&
    price.recurring?.interval === spec.interval
  );
}

async function ensurePlan(
  options: StripeClientOptions,
  spec: PlanSpec,
  reconcilePrices: boolean,
  log: (line: string) => void,
) {
  const query = new URLSearchParams({
    active: "true",
    "expand[]": "data.product",
    "lookup_keys[]": spec.lookupKey,
  });

  const listed = await requestJson(
    options,
    "GET",
    `/v1/prices?${query.toString()}`,
    priceListSchema,
    null,
  );

  const [existing] = listed.data;

  if (existing?.active === true) {
    if (!existing.product.active) {
      throw new Error(
        `Stripe price ${existing.id} holds lookup key ${spec.lookupKey} on inactive product ${existing.product.id}; reactivate that product or archive the price before re-running.`,
      );
    }

    if (priceMatches(existing, spec)) {
      log(`Reused the active ${spec.plan} price ${existing.id} (${spec.lookupKey}).`);

      return { plan: spec.plan, priceId: existing.id, productId: existing.product.id };
    }

    if (!reconcilePrices) {
      throw new Error(
        `Stripe price ${existing.id} already holds lookup key ${spec.lookupKey} at ` +
          `${String(existing.unit_amount)} ${existing.currency} per ${existing.recurring?.interval ?? "one-off"}, ` +
          `not ${String(spec.unitAmount)} usd per ${spec.interval}; reconcile that price in Stripe before re-running, or pass --reconcile-prices to replace it.`,
      );
    }

    const created = await requestJson(
      options,
      "POST",
      "/v1/prices",
      createdPriceSchema,
      new URLSearchParams({
        active: "true",
        currency: "usd",
        "metadata[overture_plan]": spec.plan,
        nickname: spec.productName,
        product: existing.product.id,
        "recurring[interval]": spec.interval,
        transfer_lookup_key: "true",
        unit_amount: String(spec.unitAmount),
        lookup_key: spec.lookupKey,
      }),
    );

    await requestJson(
      options,
      "POST",
      `/v1/prices/${encodeURIComponent(existing.id)}`,
      createdPriceSchema,
      new URLSearchParams({ active: "false" }),
    );

    log(
      `Replaced drifted ${spec.plan} price ${existing.id} with ${created.id} (${spec.lookupKey}) and archived ${existing.id}.`,
    );

    return { plan: spec.plan, priceId: created.id, productId: existing.product.id };
  }

  const product = await requestJson(
    options,
    "POST",
    "/v1/products",
    createdProductSchema,
    new URLSearchParams({
      "metadata[overture_plan]": spec.plan,
      name: spec.productName,
      tax_code: "txcd_10103000",
    }),
  );

  log(`Created the ${spec.plan} product ${product.id}.`);

  const price = await requestJson(
    options,
    "POST",
    "/v1/prices",
    createdPriceSchema,
    new URLSearchParams({
      active: "true",
      currency: "usd",
      "metadata[overture_plan]": spec.plan,
      nickname: spec.productName,
      product: product.id,
      "recurring[interval]": spec.interval,
      unit_amount: String(spec.unitAmount),
      lookup_key: spec.lookupKey,
    }),
  );

  log(`Created the ${spec.plan} price ${price.id} (${spec.lookupKey}).`);

  return { plan: spec.plan, priceId: price.id, productId: product.id };
}

function webhookForm(url: string) {
  const form = new URLSearchParams({ url });

  for (const event of WEBHOOK_EVENTS) {
    form.append("enabled_events[]", event);
  }

  return form;
}

function hasEveryEvent(events: readonly string[]) {
  return (
    events.length === WEBHOOK_EVENTS.length &&
    WEBHOOK_EVENTS.every((event) => events.includes(event))
  );
}

async function createWebhook(options: StripeClientOptions, url: string) {
  const created = await requestJson(
    options,
    "POST",
    "/v1/webhook_endpoints",
    webhookEndpointSchema,
    webhookForm(url),
  );

  const { secret } = created;

  if (secret === undefined) {
    throw new Error(
      `Stripe created webhook endpoint ${created.id} without returning its signing secret; rotate it again.`,
    );
  }

  return { id: created.id, secret };
}

async function ensureWebhook(
  options: StripeClientOptions,
  url: string,
  rotate: boolean,
  log: (line: string) => void,
) {
  const listed = await requestJson(
    options,
    "GET",
    "/v1/webhook_endpoints?limit=100",
    webhookListSchema,
    null,
  );

  const existing = listed.data.find(
    (endpoint) => endpoint.url === url && endpoint.status === "enabled",
  );

  if (existing !== undefined && rotate) {
    const created = await createWebhook(options, url);

    await requestJson(
      options,
      "DELETE",
      `/v1/webhook_endpoints/${encodeURIComponent(existing.id)}`,
      deletedWebhookSchema,
      null,
    );

    log(`Created webhook endpoint ${created.id} and removed the previous endpoint ${existing.id}.`);

    return { id: created.id, rotated: true, secret: created.secret };
  }

  if (existing !== undefined) {
    if (!hasEveryEvent(existing.enabled_events)) {
      const updated = await requestJson(
        options,
        "POST",
        `/v1/webhook_endpoints/${encodeURIComponent(existing.id)}`,
        webhookEndpointSchema,
        webhookForm(url),
      );

      log(
        `Updated webhook endpoint ${updated.id} to all nine events; its signing secret was not rotated.`,
      );

      return { id: updated.id, rotated: false, secret: null };
    }

    log(
      `Webhook endpoint ${existing.id} already listens to all nine events; its signing secret was not rotated.`,
    );

    return { id: existing.id, rotated: false, secret: null };
  }

  const created = await createWebhook(options, url);

  log(`Created webhook endpoint ${created.id} for ${url}.`);

  return { id: created.id, rotated: false, secret: created.secret };
}

function portalForm(plans: readonly PlanIds[], origin: string) {
  const form = new URLSearchParams({
    "business_profile[privacy_policy_url]": `${origin}/privacy`,
    "business_profile[terms_of_service_url]": `${origin}/terms`,
    default_return_url: `${origin}/profile/billing`,
    "features[invoice_history][enabled]": "true",
    "features[payment_method_update][enabled]": "true",
    "features[subscription_cancel][enabled]": "true",
    "features[subscription_cancel][mode]": "at_period_end",
    "features[subscription_update][enabled]": "true",
    "features[subscription_update][proration_behavior]": "none",
  });

  form.append("features[subscription_update][default_allowed_updates][]", "price");

  for (const [index, plan] of plans.entries()) {
    form.set(`features[subscription_update][products][${String(index)}][product]`, plan.productId);
    form.set(`features[subscription_update][products][${String(index)}][prices][0]`, plan.priceId);
  }

  return form;
}

function portalMatches(
  configuration: z.infer<typeof portalConfigurationSchema>,
  plans: readonly PlanIds[],
  origin: string,
) {
  const { features } = configuration;

  if (
    !configuration.active ||
    configuration.default_return_url !== `${origin}/profile/billing` ||
    configuration.business_profile.privacy_policy_url !== `${origin}/privacy` ||
    configuration.business_profile.terms_of_service_url !== `${origin}/terms` ||
    !features.invoice_history.enabled ||
    !features.payment_method_update.enabled ||
    !features.subscription_cancel.enabled ||
    features.subscription_cancel.mode !== "at_period_end" ||
    !features.subscription_update.enabled ||
    features.subscription_update.proration_behavior !== "none"
  ) {
    return false;
  }

  const products = features.subscription_update.products ?? [];

  return plans.every((plan) =>
    products.some(
      (entry) => entry.product === plan.productId && entry.prices.includes(plan.priceId),
    ),
  );
}

async function ensurePortal(
  options: StripeClientOptions,
  plans: readonly PlanIds[],
  origin: string,
  log: (line: string) => void,
) {
  const listed = await requestJson(
    options,
    "GET",
    "/v1/billing_portal/configurations?active=true&limit=100",
    portalListSchema,
    null,
  );

  const preferred = listed.data.find((configuration) => configuration.is_default) ?? listed.data[0];

  if (preferred !== undefined && portalMatches(preferred, plans, origin)) {
    log(
      `Billing portal configuration ${preferred.id} already cancels at period end, updates payment methods and switches between Week and Month.`,
    );

    return preferred.id;
  }

  if (preferred !== undefined) {
    const updated = await requestJson(
      options,
      "POST",
      `/v1/billing_portal/configurations/${encodeURIComponent(preferred.id)}`,
      portalConfigurationSchema,
      portalForm(plans, origin),
    );

    log(`Updated billing portal configuration ${updated.id}.`);

    return updated.id;
  }

  const created = await requestJson(
    options,
    "POST",
    "/v1/billing_portal/configurations",
    portalConfigurationSchema,
    portalForm(plans, origin),
  );

  log(`Created billing portal configuration ${created.id}.`);

  return created.id;
}

function writeEnvFile(path: string, result: StripeSetupResult, log: (line: string) => void) {
  const lines = [
    `STRIPE_PRICE_WEEK=${result.priceIds.week}`,
    `STRIPE_PRICE_MONTH=${result.priceIds.month}`,
  ];

  if (result.webhook.secret !== null) {
    lines.push(`STRIPE_WEBHOOK_SECRET=${result.webhook.secret}`);
  }

  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  log(`Wrote ${String(lines.length)} Stripe environment entries to the requested out-env file.`);
}

export async function runStripeSetup(options: StripeSetupOptions) {
  const mode = stripeModeFor(options.secretKey);

  const clientOptions: StripeClientOptions = {
    apiBaseUrl: options.apiBaseUrl.replace(/\/+$/u, ""),
    fetch: options.fetch,
    secretKey: options.secretKey,
  };

  options.log(`Stripe key mode: ${mode}.`);

  const weekPlan = await ensurePlan(clientOptions, WEEK_SPEC, options.reconcilePrices, options.log);

  const monthPlan = await ensurePlan(
    clientOptions,
    MONTH_SPEC,
    options.reconcilePrices,
    options.log,
  );

  const plans = [weekPlan, monthPlan];

  const priceIds: Record<BillingPlan, string> = {
    month: monthPlan.priceId,
    week: weekPlan.priceId,
  };

  const origin = options.appOrigin.replace(/\/+$/u, "");
  const webhookUrl = `${origin}/webhooks/stripe`;

  const webhook = await ensureWebhook(
    clientOptions,
    webhookUrl,
    options.rotateWebhook,
    options.log,
  );

  const portalConfigurationId = await ensurePortal(clientOptions, plans, origin, options.log);

  const result: StripeSetupResult = {
    mode,
    portalConfigurationId,
    priceIds,
    webhook,
  };

  if (options.outEnvPath !== null) {
    writeEnvFile(options.outEnvPath, result, options.log);
  }

  return result;
}

function argumentValue(args: readonly string[], name: string) {
  const index = args.indexOf(name);

  return index === -1 ? null : (args[index + 1] ?? null);
}

async function main() {
  const args = process.argv.slice(2);
  const secretKey = Bun.env.STRIPE_SECRET_KEY;

  if (secretKey === undefined) {
    process.stderr.write(
      "set STRIPE_SECRET_KEY in the environment before running the Stripe setup script.\n",
    );
    process.exitCode = 1;

    return;
  }

  const result = await runStripeSetup({
    apiBaseUrl: Bun.env.STRIPE_API_BASE_URL ?? "https://api.stripe.com",
    appOrigin: Bun.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
    fetch: async (url, request) => fetch(url, request),
    log: (line) => process.stdout.write(`${line}\n`),
    outEnvPath: argumentValue(args, "--out-env"),
    reconcilePrices: args.includes("--reconcile-prices"),
    rotateWebhook: args.includes("--rotate-webhook"),
    secretKey,
  });

  process.stdout.write(`Week price: ${result.priceIds.week}\n`);
  process.stdout.write(`Month price: ${result.priceIds.month}\n`);
  process.stdout.write(`Billing portal configuration: ${result.portalConfigurationId}\n`);
}

if (import.meta.main) {
  await main();
}
