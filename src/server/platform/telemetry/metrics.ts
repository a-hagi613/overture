import { metrics as otelMetrics } from "@opentelemetry/api";
import type { Attributes, Counter, Histogram, Meter, ObservableGauge } from "@opentelemetry/api";

import { OTEL_METRIC_ATTRIBUTE_DENYLIST } from "./otel.ts";
import { batchPricesFor } from "../llm/models.ts";

/**
 * Every metric Overture exports over the private Prometheus endpoint (WS-21, issue #634). The names are
 * part of the Grafana dashboard contract (`docs/ops/grafana/overture-prod-dashboard.json`), so a rename
 * here needs the dashboard and its test updated in the same change.
 */
export const METRIC_NAMES = {
  applyDuration: "overture_apply_duration_ms",
  applyRuns: "overture_apply_runs_total",
  bgJobDuration: "overture_bg_job_duration_ms",
  bgQueueDepth: "overture_bg_queue_depth",
  billingEvents: "overture_billing_events_total",
  catalogPostings: "overture_catalog_postings_total",
  catalogSwapBytes: "overture_catalog_swap_bytes",
  catalogSwapDuration: "overture_catalog_swap_duration_ms",
  catalogSwapFailures: "overture_catalog_swap_failures_total",
  credits: "overture_credits",
  eventLoopLag: "overture_event_loop_lag_ms",
  formSelfHeal: "overture_form_self_heal_total",
  httpDuration: "overture_http_duration_ms",
  httpRequests: "overture_http_requests_total",
  llmCostUsd: "overture_llm_cost_usd_total",
  llmRequests: "overture_llm_requests_total",
  llmTokens: "overture_llm_tokens_total",
  mailEvents: "overture_mail_events_total",
  matchQueue: "overture_match_queue",
  productApplications: "overture_applications",
  spendUsd: "overture_spend_usd",
  sqliteQueryDuration: "overture_sqlite_query_duration_ms",
  supplyQueryDuration: "overture_supply_query_duration_ms",
  tagCoverageRatio: "overture_tag_coverage_ratio",
  users: "overture_users",
} as const;

export type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];

/**
 * Metric labels are a cardinality budget. These are the only labels an exporter may see, and the
 * denylist in `otel.ts` is applied at record time as a second line of defence.
 */
export const METRIC_ATTRIBUTE_NAMES = [
  "ats",
  "db",
  "direction",
  "event",
  "kind",
  "method",
  "mode",
  "model",
  "op",
  "outcome",
  "plan",
  "purpose",
  "reason",
  "route",
  "status",
  "status_class",
  "tier",
] as const;

export type MetricAttributes = Readonly<Record<string, string | number>>;

/**
 * The product gauges the stats sampler fills from the database every minute: people, applications,
 * the match queue, credits and spend. Each carries one bounded label (a status or a kind).
 */
export const PRODUCT_GAUGES = [
  {
    description: "People by state: total, verified, onboarded, running, signed in, online",
    key: "users",
    label: "status",
  },
  { description: "Applications by status", key: "productApplications", label: "status" },
  {
    description: "Match queue rows across all users: pooled and scored",
    key: "matchQueue",
    label: "status",
  },
  { description: "Credits across all users by ledger account", key: "credits", label: "kind" },
  {
    description: "Spend to date in US dollars, by kind (llm, browser)",
    key: "spendUsd",
    label: "kind",
  },
] as const satisfies readonly {
  description: string;
  key: keyof typeof METRIC_NAMES;
  label: string;
}[];

export type ProductGauge = (typeof PRODUCT_GAUGES)[number]["key"];

const ALLOWED_METRIC_ATTRIBUTES = new Set<string>(METRIC_ATTRIBUTE_NAMES);

/**
 * Whether an attribute must never become a metric label. It rejects the shared denylist plus the
 * identifiers WS-21 names explicitly: a user, a job, an email address or a raw URL would turn one
 * series into one series per person or posting.
 * @param key The attribute name a caller wants to attach.
 * @returns true when the label has to be dropped.
 */
export function isDeniedMetricAttribute(key: string) {
  const normalized = key.trim().toLowerCase();

  if (OTEL_METRIC_ATTRIBUTE_DENYLIST.has(key) || OTEL_METRIC_ATTRIBUTE_DENYLIST.has(normalized)) {
    return true;
  }

  return (
    normalized === "user_id" ||
    normalized === "job_id" ||
    normalized === "application_id" ||
    normalized === "email" ||
    normalized === "email_address" ||
    normalized.endsWith("_email") ||
    normalized.includes("@")
  );
}

/**
 * Drops every denied label and normalizes dots to underscores so Prometheus sees stable names.
 * A denied key is silently removed rather than throwing: a metric call site must never be able to
 * break a request, and the unit tests assert the dangerous names never reach an export.
 * @param attributes The candidate labels.
 * @returns The labels safe to attach to an instrument.
 */
export function sanitizeMetricAttributes(attributes: MetricAttributes | undefined) {
  const clean: Attributes = {};

  if (attributes === undefined) {
    return clean;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (isDeniedMetricAttribute(key) || !ALLOWED_METRIC_ATTRIBUTES.has(key)) {
      continue;
    }

    clean[key] = value;
  }

  return clean;
}

/**
 * Cost in USD for one model call, computed against the rate card in `platform/llm/models.ts`.
 * `costMicros` from a call is already priced, so this is only used when a caller has raw tokens.
 * @param model The model name the provider reported.
 * @param tokens The token counts of the call.
 * @returns The call cost in US dollars.
 */
export function llmCostUsd(
  model: string,
  tokens: {
    inputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  },
) {
  const prices = batchPricesFor(model);

  const micros =
    (tokens.inputTokens * prices.inputPerMillionTokens +
      tokens.cachedTokens * prices.cacheReadPerMillionTokens +
      tokens.cacheWriteTokens * prices.cacheWritePerMillionTokens +
      tokens.outputTokens * prices.outputPerMillionTokens) /
    1_000_000;

  return micros / 1_000_000;
}

/**
 * The low-cardinality instrument set. Every method sanitizes its labels, and the labels themselves
 * are bounded templates (`/api/supply`, an ATS name, a plan name), never a user id or a raw URL.
 */
export class MetricsRecorder {
  private readonly applyDuration: Histogram;
  private readonly applyRuns: Counter;
  private readonly bgJobDuration: Histogram;
  private readonly bgQueueDepth: ObservableGauge;
  private readonly billingEvents: Counter;
  private readonly catalogPostings: Counter;
  private readonly catalogSwapBytes: Histogram;
  private readonly catalogSwapDuration: Histogram;
  private readonly catalogSwapFailures: Counter;
  private readonly eventLoopLag: Histogram;
  private readonly formSelfHeal: Counter;
  private readonly httpDuration: Histogram;
  private readonly httpRequests: Counter;
  private readonly llmCost: Counter;
  private readonly llmRequests: Counter;
  private readonly llmTokens: Counter;
  private readonly mailEvents: Counter;
  private readonly sqliteQueryDuration: Histogram;
  private readonly supplyQueryDuration: Histogram;
  private readonly tagCoverage: ObservableGauge;
  private readonly productGauges = new Map<ProductGauge, Map<string, number>>();
  private readonly queueDepthByKind = new Map<string, number>();
  private readonly tagCoverageByTier = new Map<string, number>();

  constructor(meter: Meter) {
    this.applyDuration = meter.createHistogram(METRIC_NAMES.applyDuration, {
      description: "How long one application attempt took, by ATS and outcome",
      unit: "ms",
    });
    this.applyRuns = meter.createCounter(METRIC_NAMES.applyRuns, {
      description: "Application attempts, by ATS, dispatch mode and outcome",
    });
    this.bgJobDuration = meter.createHistogram(METRIC_NAMES.bgJobDuration, {
      description: "Background job duration, by kind and final status",
      unit: "ms",
    });
    this.bgQueueDepth = meter.createObservableGauge(METRIC_NAMES.bgQueueDepth, {
      description: "Queued background jobs, sampled from the scheduler, by kind",
    });
    this.billingEvents = meter.createCounter(METRIC_NAMES.billingEvents, {
      description: "Stripe billing events, by event type and plan",
    });
    this.catalogPostings = meter.createCounter(METRIC_NAMES.catalogPostings, {
      description: "Postings applied by a catalog hot swap",
    });
    this.catalogSwapBytes = meter.createHistogram(METRIC_NAMES.catalogSwapBytes, {
      description: "Uncompressed catalog snapshot size per applied swap",
      unit: "By",
    });
    this.catalogSwapDuration = meter.createHistogram(METRIC_NAMES.catalogSwapDuration, {
      description: "Catalog hot-swap duration",
      unit: "ms",
    });
    this.catalogSwapFailures = meter.createCounter(METRIC_NAMES.catalogSwapFailures, {
      description: "Catalog hot swaps that could not be applied, by reason",
    });
    this.eventLoopLag = meter.createHistogram(METRIC_NAMES.eventLoopLag, {
      description: "Timer drift of the event loop sampler",
      unit: "ms",
    });
    this.formSelfHeal = meter.createCounter(METRIC_NAMES.formSelfHeal, {
      description: "Employer form changes repaired without asking the user, by ATS and outcome",
    });
    this.httpDuration = meter.createHistogram(METRIC_NAMES.httpDuration, {
      description: "HTTP request duration, by bounded route template",
      unit: "ms",
    });
    this.httpRequests = meter.createCounter(METRIC_NAMES.httpRequests, {
      description: "HTTP requests, by bounded route template, method and status class",
    });
    this.llmCost = meter.createCounter(METRIC_NAMES.llmCostUsd, {
      description: "LLM spend in US dollars, by purpose",
      unit: "USD",
    });
    this.llmRequests = meter.createCounter(METRIC_NAMES.llmRequests, {
      description: "LLM calls, by purpose, model and status",
    });
    this.llmTokens = meter.createCounter(METRIC_NAMES.llmTokens, {
      description: "LLM tokens, by purpose and direction",
    });
    this.mailEvents = meter.createCounter(METRIC_NAMES.mailEvents, {
      description: "Mail send events, by direction and status",
    });
    this.sqliteQueryDuration = meter.createHistogram(METRIC_NAMES.sqliteQueryDuration, {
      description: "SQLite statement duration, by database and operation",
      unit: "ms",
    });
    this.supplyQueryDuration = meter.createHistogram(METRIC_NAMES.supplyQueryDuration, {
      description: "Public supply count query duration",
      unit: "ms",
    });
    this.tagCoverage = meter.createObservableGauge(METRIC_NAMES.tagCoverageRatio, {
      description: "Share of open postings with a role tag, by tagging tier",
    });

    for (const gauge of PRODUCT_GAUGES) {
      const values = new Map<string, number>();

      this.productGauges.set(gauge.key, values);
      meter
        .createObservableGauge(METRIC_NAMES[gauge.key], { description: gauge.description })
        .addCallback((result) => {
          for (const [label, value] of values) {
            result.observe(value, sanitizeMetricAttributes({ [gauge.label]: label }));
          }
        });
    }

    this.bgQueueDepth.addCallback((result) => {
      for (const [kind, depth] of this.queueDepthByKind) {
        result.observe(depth, sanitizeMetricAttributes({ kind }));
      }
    });
    this.tagCoverage.addCallback((result) => {
      for (const [tier, ratio] of this.tagCoverageByTier) {
        result.observe(ratio, sanitizeMetricAttributes({ tier }));
      }
    });
  }

  recordHttpRequest(input: {
    route: string;
    method: string;
    statusClass: string;
    durationMs: number;
  }) {
    const labels = sanitizeMetricAttributes({
      method: input.method,
      route: input.route,
      status_class: input.statusClass,
    });

    this.httpRequests.add(1, labels);
    this.httpDuration.record(input.durationMs, sanitizeMetricAttributes({ route: input.route }));
  }

  recordEventLoopLag(lagMs: number) {
    this.eventLoopLag.record(Math.max(0, lagMs));
  }

  recordSqliteQuery(input: { db: string; op: string; durationMs: number }) {
    this.sqliteQueryDuration.record(
      input.durationMs,
      sanitizeMetricAttributes({ db: input.db, op: input.op }),
    );
  }

  recordSupplyQuery(durationMs: number) {
    this.supplyQueryDuration.record(durationMs);
  }

  recordCatalogSwap(input: { bytes: number; durationMs: number; postings: number }) {
    const labels = sanitizeMetricAttributes({ outcome: "applied" });

    this.catalogSwapDuration.record(input.durationMs, labels);
    this.catalogSwapBytes.record(input.bytes, labels);
    this.catalogPostings.add(input.postings, labels);
  }

  recordCatalogSwapFailure(reason: string) {
    this.catalogSwapFailures.add(1, sanitizeMetricAttributes({ reason }));
  }

  recordApplyAttempt(input: { ats: string; mode: string; outcome: string; durationMs: number }) {
    const labels = sanitizeMetricAttributes({
      ats: input.ats,
      mode: input.mode,
      outcome: input.outcome,
    });

    this.applyRuns.add(1, labels);
    this.applyDuration.record(
      input.durationMs,
      sanitizeMetricAttributes({ ats: input.ats, outcome: input.outcome }),
    );
  }

  /**
   * WS-20a emits into this when a changed employer form is repaired without the user.
   * @param input The ATS and self-heal outcome.
   */
  recordFormSelfHeal(input: { ats: string; outcome: string }) {
    this.formSelfHeal.add(1, sanitizeMetricAttributes({ ats: input.ats, outcome: input.outcome }));
  }

  recordLlmCall(input: {
    purpose: string;
    model: string;
    status: "ok" | "error";
    inputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    costMicros?: number | undefined;
  }) {
    this.llmRequests.add(
      1,
      sanitizeMetricAttributes({
        model: input.model,
        purpose: input.purpose,
        status: input.status,
      }),
    );

    const inputTotal = input.inputTokens + input.cachedTokens + input.cacheWriteTokens;

    if (inputTotal > 0) {
      this.llmTokens.add(
        inputTotal,
        sanitizeMetricAttributes({ direction: "input", purpose: input.purpose }),
      );
    }

    if (input.outputTokens > 0) {
      this.llmTokens.add(
        input.outputTokens,
        sanitizeMetricAttributes({ direction: "output", purpose: input.purpose }),
      );
    }

    const usd =
      input.costMicros === undefined
        ? llmCostUsd(input.model, input)
        : input.costMicros / 1_000_000;

    if (usd > 0) {
      this.llmCost.add(usd, sanitizeMetricAttributes({ purpose: input.purpose }));
    }
  }

  recordMailEvent(input: { direction: "inbound" | "outbound"; status: string }) {
    this.mailEvents.add(
      1,
      sanitizeMetricAttributes({ direction: input.direction, status: input.status }),
    );
  }

  recordBillingEvent(input: { event: string; plan: string }) {
    this.billingEvents.add(1, sanitizeMetricAttributes({ event: input.event, plan: input.plan }));
  }

  recordBgJob(input: { kind: string; status: string; durationMs: number }) {
    const labels = sanitizeMetricAttributes({ kind: input.kind, status: input.status });

    this.bgJobDuration.record(input.durationMs, labels);
  }

  setBgQueueDepth(kind: string, depth: number) {
    this.queueDepthByKind.set(kind, Math.max(0, depth));
  }

  /**
   * Replaces every value of one product gauge, so a status that dropped to nothing stops reporting
   * its old count.
   * @param gauge Which product gauge.
   * @param values Its value per label.
   */
  setProductGauge(gauge: ProductGauge, values: Readonly<Record<string, number>>) {
    const current = this.productGauges.get(gauge);

    if (current === undefined) {
      return;
    }

    current.clear();

    for (const [label, value] of Object.entries(values)) {
      current.set(label, Math.max(0, value));
    }
  }

  productGaugeValues(gauge: ProductGauge) {
    return Object.fromEntries(this.productGauges.get(gauge) ?? []);
  }

  setTagCoverageRatio(tier: string, ratio: number) {
    this.tagCoverageByTier.set(tier, Math.min(1, Math.max(0, ratio)));
  }
}

/**
 * Builds the instrument set on one meter.
 * @param meter The meter that owns the instruments.
 * @returns A recorder with one method per metric.
 */
export function createMetrics(meter: Meter) {
  return new MetricsRecorder(meter);
}

let defaultRecorder: MetricsRecorder | null = null;

/**
 * The process-wide recorder. It is created on first use rather than at import because an
 * instrument binds to the meter provider that exists when it is created; `startTelemetry` installs
 * the provider, so an eager import-time recorder would bind to the no-op meter and export nothing.
 * @returns The recorder bound to the current global meter.
 */
export function defaultMetrics() {
  defaultRecorder ??= createMetrics(otelMetrics.getMeter("overture"));

  return defaultRecorder;
}
