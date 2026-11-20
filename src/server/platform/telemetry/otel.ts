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
import type { Context } from "@opentelemetry/api";
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
  "otel.status_code",
  "otel.status_description",
]);

export function redactAttributes(attributes: Record<string, string | number | boolean>) {
  const redacted: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    redacted[key] = OTEL_ATTRIBUTE_ALLOWLIST.has(key) ? value : "[redacted]";
  }

  return redacted;
}

class RedactingSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor;

  constructor(inner: SpanProcessor) {
    this.inner = inner;
  }

  onStart(span: Span, parentContext: Context) {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan) {
    for (const key of Object.keys(span.attributes)) {
      if (!OTEL_ATTRIBUTE_ALLOWLIST.has(key)) {
        span.attributes[key] = "[redacted]";
      }
    }

    this.inner.onEnd(span);
  }

  async shutdown() {
    return this.inner.shutdown();
  }

  async forceFlush() {
    return this.inner.forceFlush();
  }
}

class RedactingLogExporter implements LogRecordExporter {
  private readonly inner: LogRecordExporter;

  constructor(inner: LogRecordExporter) {
    this.inner = inner;
  }

  export(logRecords: ReadableLogRecord[], resultCallback: (result: ExportResult) => void) {
    for (const record of logRecords) {
      for (const key of Object.keys(record.attributes)) {
        if (!OTEL_ATTRIBUTE_ALLOWLIST.has(key)) {
          record.attributes[key] = "[redacted]";
        }
      }
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
      : new BatchSpanProcessor(traceExporter);

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [new RedactingSpanProcessor(innerSpanProcessor)],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 30_000,
      }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: logExporter })],
    textMapPropagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  });

  sdk.start();

  return sdk;
}
