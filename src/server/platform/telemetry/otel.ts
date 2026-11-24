import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { Attributes, Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { ExportResult } from "@opentelemetry/core";

export { trace } from "@opentelemetry/api";

export const METRIC_EXPORT_INTERVAL_MILLIS = 60_000;

export const BATCH_PROCESSOR_LIMITS = {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 5000,
} as const;

export const OTEL_METRIC_ATTRIBUTE_DENYLIST = new Set([
  "http.url",
  "job.id",
  "sse.user_id",
  "admin.target_user_id",
]);

export const OTEL_ATTRIBUTE_ALLOWLIST = new Set([
  "service.name",
  "service.version",
  "http.method",
  "http.route",
  "http.status_code",
  "http.url",
  "db.system",
  "db.operation",
  "db.statement",
  "error.type",
  "error.message",
  "job.kind",
  "job.id",
  "job.attempts",
  "job.status",
  "sse.topic",
  "sse.user_id",
  "setting.key",
  "kill_switch.scope",
  "kill_switch.key",
  "admin.action",
  "admin.target_user_id",
  "otel.status_code",
  "otel.status_description",
]);

export function stripUrlQueryAndFragment(url: string) {
  const queryIndex = url.indexOf("?");
  const fragmentIndex = url.indexOf("#");

  if (queryIndex === -1 && fragmentIndex === -1) {
    return url;
  }

  const cutIndex =
    queryIndex === -1 || fragmentIndex === -1
      ? Math.max(queryIndex, fragmentIndex)
      : Math.min(queryIndex, fragmentIndex);

  return url.slice(0, cutIndex);
}

function redactAndStripUrl(attributes: Attributes) {
  for (const key of Object.keys(attributes)) {
    if (!OTEL_ATTRIBUTE_ALLOWLIST.has(key)) {
      attributes[key] = "[redacted]";

      continue;
    }

    if (key !== "http.url") {
      continue;
    }

    const value = attributes[key]?.toString();

    if (value !== undefined) {
      attributes[key] = stripUrlQueryAndFragment(value);
    }
  }
}

export class RedactingSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor;

  constructor(inner: SpanProcessor) {
    this.inner = inner;
  }

  onStart(span: Span, parentContext: Context) {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan) {
    redactAndStripUrl(span.attributes);

    this.inner.onEnd(span);
  }

  async shutdown() {
    return this.inner.shutdown();
  }

  async forceFlush() {
    return this.inner.forceFlush();
  }
}

export class RedactingLogExporter implements LogRecordExporter {
  private readonly inner: LogRecordExporter;

  constructor(inner: LogRecordExporter) {
    this.inner = inner;
  }

  export(logRecords: ReadableLogRecord[], resultCallback: (result: ExportResult) => void) {
    for (const record of logRecords) {
      redactAndStripUrl(record.attributes);
    }

    this.inner.export(logRecords, resultCallback);
  }

  async shutdown() {
    return this.inner.shutdown();
  }

  async forceFlush() {
    return this.inner.forceFlush();
  }
}

function parseHeaders(raw?: string) {
  if (!raw) {
    return {};
  }

  const headers: Record<string, string> = {};

  for (const pair of raw.split(",")) {
    const eqIdx = pair.indexOf("=");

    if (eqIdx > 0) {
      headers[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }
  }

  return headers;
}

function makeExporterConfig(endpoint: string | undefined, rawHeaders?: string) {
  const headers = parseHeaders(rawHeaders);

  return endpoint === undefined ? { headers } : { url: endpoint, headers };
}

let testSpanExporter: InMemorySpanExporter | null = null;

export function getTestSpans() {
  return testSpanExporter === null ? [] : testSpanExporter.getFinishedSpans();
}

export function resetTestSpans() {
  testSpanExporter?.reset();
}

export function startTelemetry(options: {
  serviceName: string;
  otlpEndpoint?: string;
  otlpHeaders?: string;
  debug?: boolean;
  simpleExport?: boolean;
}) {
  if (options.debug === true) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    [ATTR_SERVICE_VERSION]: "0.1.0",
  });

  const traceEndpoint =
    options.otlpEndpoint === undefined ? undefined : `${options.otlpEndpoint}/v1/traces`;

  const metricEndpoint =
    options.otlpEndpoint === undefined ? undefined : `${options.otlpEndpoint}/v1/metrics`;

  const logEndpoint =
    options.otlpEndpoint === undefined ? undefined : `${options.otlpEndpoint}/v1/logs`;

  let traceExporter: SpanExporter;

  if (options.simpleExport === true) {
    testSpanExporter = new InMemorySpanExporter();
    traceExporter = testSpanExporter;
  } else {
    traceExporter = new OTLPTraceExporter(makeExporterConfig(traceEndpoint, options.otlpHeaders));
  }

  const metricExporter = new OTLPMetricExporter(
    makeExporterConfig(metricEndpoint, options.otlpHeaders),
  );

  const logExporter = new RedactingLogExporter(
    new OTLPLogExporter(makeExporterConfig(logEndpoint, options.otlpHeaders)),
  );

  const innerSpanProcessor =
    options.simpleExport === true
      ? new SimpleSpanProcessor(traceExporter)
      : new BatchSpanProcessor(traceExporter, BATCH_PROCESSOR_LIMITS);

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [new RedactingSpanProcessor(innerSpanProcessor)],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MILLIS,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({ exporter: logExporter, ...BATCH_PROCESSOR_LIMITS }),
    ],
    textMapPropagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  });

  sdk.start();

  return sdk;
}
