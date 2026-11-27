import { Buffer } from "node:buffer";

import { z } from "zod";

import type { LlmBatchCall, LlmPort, LlmRequest } from "../ports/llm.ts";
import type { BatchProvider, DurableBatches, ProviderBatch } from "./durable-batches.ts";

import { batchPricesFor } from "./models.ts";
import { BatchGoneError } from "./durable-batches.ts";
import { defaultMetrics } from "../telemetry/metrics.ts";
import { logError } from "../log.ts";
import {
  DEFAULT_LLM_MAX_ATTEMPTS,
  DEFAULT_LLM_TIMEOUT_MS,
  llmFetch,
  LlmHttpError,
  LLM_RETRY_BASE_MS,
} from "./http.ts";

const API_VERSION = "2023-06-01";
const MAX_TOKENS = 1024;
const ESTIMATED_OUTPUT_TOKENS = 200;
const CHARS_PER_TOKEN = 4;
const SINGLE_MAX_TOKENS = 4096;
const PDF_BYTES_PER_TOKEN = 3;

const requestCountsSchema = z.object({
  processing: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  errored: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
});

const batchSchema = z.object({
  type: z.literal("message_batch"),
  id: z.string().min(1),
  processing_status: z.enum(["in_progress", "canceling", "ended"]),
  request_counts: requestCountsSchema,
  results_url: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
});

const messageUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

const messageSchema = z
  .object({
    id: z.string().min(1),
    model: z.string().min(1),
    content: z.array(z.object({ type: z.string(), text: z.string().nullish() })),
    usage: messageUsageSchema,
  })
  .transform((message) => {
    const textBlock = message.content.find(
      (block) => block.type === "text" && block.text !== null && block.text !== undefined,
    );

    return {
      model: message.model,
      text: textBlock?.text ?? null,
      usage: message.usage,
    };
  });

const resultLineSchema = z.object({
  custom_id: z.string(),
  result: z.discriminatedUnion("type", [
    z.object({ type: z.literal("succeeded"), message: messageSchema }),
    z.object({
      type: z.literal("errored"),
      error: z.object({ type: z.string(), message: z.string().nullish() }),
    }),
    z.object({ type: z.literal("canceled") }),
    z.object({ type: z.literal("expired") }),
  ]),
});

interface TokenUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

const unpricedModels = new Set<string>();

function priceFor(model: string) {
  try {
    return batchPricesFor(model);
  } catch {
    if (!unpricedModels.has(model)) {
      unpricedModels.add(model);

      logError(
        "llm.cost",
        new Error(
          `no batch pricing is known for model ${model}; recording its calls with zero cost until the rate card lists it`,
        ),
      );
    }

    return null;
  }
}

function microsFor(prices: ReturnType<typeof batchPricesFor>, usage: TokenUsage) {
  const micros =
    (usage.input * prices.inputPerMillionTokens +
      usage.cacheRead * prices.cacheReadPerMillionTokens +
      usage.cacheWrite * prices.cacheWritePerMillionTokens +
      usage.output * prices.outputPerMillionTokens) /
    1_000_000;

  return Math.ceil(micros);
}

function strictCostMicrosFor(model: string, usage: TokenUsage) {
  return microsFor(batchPricesFor(model), usage);
}

function costMicrosFor(model: string, usage: TokenUsage) {
  const prices = priceFor(model);

  if (prices === null) {
    return 0;
  }

  return microsFor(prices, usage);
}

function estimatedUsageFor(request: LlmRequest) {
  return {
    input: Math.ceil(
      (request.system.length + (request.cachePrefix?.length ?? 0) + request.user.length) /
        CHARS_PER_TOKEN,
    ),
    cacheRead: 0,
    cacheWrite: 0,
    output: ESTIMATED_OUTPUT_TOKENS,
  };
}

function messageContent(cachePrefix: string | undefined, user: string) {
  if (cachePrefix === undefined || cachePrefix.trim() === "") {
    return user;
  }

  return [
    { type: "text", text: cachePrefix, cache_control: { type: "ephemeral" } },
    { type: "text", text: user },
  ];
}

function parseJson(text: string) {
  const value: unknown = JSON.parse(text);

  return value;
}

export interface AnthropicLlmConfig {
  baseUrl: string;
  apiKey: string | undefined;
  /** How long one HTTP attempt may take before it aborts; defaults to `DEFAULT_LLM_TIMEOUT_MS`. */
  timeoutMs?: number | undefined;
  /** The total attempts per request, including the first; defaults to `DEFAULT_LLM_MAX_ATTEMPTS`. */
  maxAttempts?: number | undefined;
  /** The base of the jittered retry backoff; defaults to `LLM_RETRY_BASE_MS`. */
  retryBaseMs?: number | undefined;
  model: string;
}

function retryPolicy(config: AnthropicLlmConfig) {
  return {
    maxAttempts: config.maxAttempts ?? DEFAULT_LLM_MAX_ATTEMPTS,
    retryBaseMs: config.retryBaseMs ?? LLM_RETRY_BASE_MS,
    timeoutMs: config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
  };
}

function providerBatch(batch: z.infer<typeof batchSchema>) {
  const expiresAt = Date.parse(batch.expires_at);

  return {
    id: batch.id,
    processingStatus: batch.processing_status,
    resultsUrl: batch.results_url,
    expiresAt: Number.isNaN(expiresAt) ? null : expiresAt,
  } satisfies ProviderBatch;
}

function createClient(config: AnthropicLlmConfig) {
  const root = config.baseUrl.replace(/\/+$/u, "");

  const headers = () => ({
    "x-api-key": config.apiKey ?? "",
    "anthropic-version": API_VERSION,
    "content-type": "application/json",
  });

  return { headers, root };
}

function sameOrigin(root: string, target: string) {
  try {
    return new URL(root).origin === new URL(target).origin;
  } catch {
    return false;
  }
}

function recordedMessageCall(message: z.infer<typeof messageSchema>, purpose: string) {
  const result = {
    model: message.model,
    text: message.text,
    inputTokens: message.usage.input_tokens,
    cachedTokens: message.usage.cache_read_input_tokens,
    cacheWriteTokens: message.usage.cache_creation_input_tokens,
    outputTokens: message.usage.output_tokens,
    costMicros: costMicrosFor(message.model, {
      input: message.usage.input_tokens,
      cacheRead: message.usage.cache_read_input_tokens,
      cacheWrite: message.usage.cache_creation_input_tokens,
      output: message.usage.output_tokens,
    }),
  };

  defaultMetrics().recordLlmCall({
    ...result,
    purpose,
    status: "ok",
  });

  return result;
}

function recordFailedCall(purpose: string, model: string) {
  defaultMetrics().recordLlmCall({
    cacheWriteTokens: 0,
    cachedTokens: 0,
    costMicros: 0,
    inputTokens: 0,
    model,
    outputTokens: 0,
    purpose,
    status: "error",
  });
}

export function createAnthropicBatchProvider(config: AnthropicLlmConfig) {
  const { root, headers } = createClient(config);

  function resultsHeaders(resultsUrl: string) {
    return sameOrigin(root, resultsUrl) ? headers() : {};
  }

  function callFor(line: z.infer<typeof resultLineSchema>) {
    if (line.result.type !== "succeeded") {
      const failure =
        line.result.type === "errored"
          ? `${line.result.error.type}: ${line.result.error.message ?? ""}`
          : line.result.type;

      return {
        customId: line.custom_id,
        result: { ok: false, error: failure },
        model: config.model,
        inputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        costMicros: 0,
      } satisfies LlmBatchCall;
    }

    const { message } = line.result;

    const usage: TokenUsage = {
      input: message.usage.input_tokens,
      cacheRead: message.usage.cache_read_input_tokens,
      cacheWrite: message.usage.cache_creation_input_tokens,
      output: message.usage.output_tokens,
    };

    const result: LlmBatchCall["result"] =
      message.text === null
        ? { ok: false, error: "the message had no text block" }
        : { ok: true, value: parseJson(message.text) };

    return {
      customId: line.custom_id,
      result,
      model: message.model,
      inputTokens: usage.input,
      cachedTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      outputTokens: usage.output,
      costMicros: costMicrosFor(message.model, usage),
    } satisfies LlmBatchCall;
  }

  return {
    create: async (requests, idempotencyKey) => {
      const response = await llmFetch(`${root}/v1/messages/batches`, {
        body: JSON.stringify({
          requests: requests.map((request) => ({
            custom_id: request.customId,
            params: {
              model: config.model,
              max_tokens: MAX_TOKENS,
              system: [
                { type: "text", text: request.system, cache_control: { type: "ephemeral" } },
              ],
              messages: [
                { role: "user", content: messageContent(request.cachePrefix, request.user) },
              ],
              output_config: { format: { type: "json_schema", schema: request.schema } },
            },
          })),
        }),
        headers: { ...headers(), "idempotency-key": idempotencyKey },
        idempotent: true,
        label: "/v1/messages/batches",
        method: "POST",
        ...retryPolicy(config),
      });

      const body: unknown = await response.json();

      return providerBatch(batchSchema.parse(body));
    },
    retrieve: async (batchId) => {
      let response: Response;

      try {
        response = await llmFetch(`${root}/v1/messages/batches/${batchId}`, {
          headers: headers(),
          idempotent: true,
          label: "batch status",
          method: "GET",
          ...retryPolicy(config),
        });
      } catch (error) {
        if (error instanceof LlmHttpError && error.status === 404) {
          throw new BatchGoneError(`the Anthropic batch ${batchId} is gone`);
        }

        throw error;
      }

      const body: unknown = await response.json();

      return providerBatch(batchSchema.parse(body));
    },
    results: async (resultsUrl) => {
      const response = await llmFetch(resultsUrl, {
        headers: resultsHeaders(resultsUrl),
        idempotent: true,
        label: "batch results",
        method: "GET",
        ...retryPolicy(config),
      });

      const body = await response.text();

      return body
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => callFor(resultLineSchema.parse(parseJson(line))));
    },
  } satisfies BatchProvider;
}

export function createAnthropicLlmPort(config: AnthropicLlmConfig, batches: DurableBatches) {
  const { headers, root } = createClient(config);

  const port: LlmPort = {
    estimateBatchCostMicros: (requests) =>
      requests.reduce(
        (total, request) => total + strictCostMicrosFor(config.model, estimatedUsageFor(request)),
        0,
      ),
    runBatch: async (requests) => {
      if (config.apiKey === undefined) {
        throw new Error("the Anthropic adapter has no api key configured");
      }

      if (requests.length === 0) {
        return [];
      }

      let calls: LlmBatchCall[];

      try {
        calls = await batches.run(requests);
      } catch (error) {
        recordFailedCall("batch", config.model);
        logError("llm.batch", error);

        throw error;
      }

      const purposeByCustomId = new Map(
        requests.map((request) => [request.customId, request.purpose]),
      );

      for (const result of calls) {
        defaultMetrics().recordLlmCall({
          cacheWriteTokens: result.cacheWriteTokens,
          cachedTokens: result.cachedTokens,
          costMicros: result.costMicros,
          inputTokens: result.inputTokens,
          model: result.model,
          outputTokens: result.outputTokens,
          purpose: purposeByCustomId.get(result.customId) ?? "unknown",
          status: result.result.ok ? "ok" : "error",
        });
      }

      return calls;
    },
    estimateSingleCostMicros: (request) =>
      strictCostMicrosFor(config.model, {
        input:
          Math.ceil(request.user.length / CHARS_PER_TOKEN) +
          Math.ceil(request.pdf.byteLength / PDF_BYTES_PER_TOKEN),
        cacheRead: 0,
        cacheWrite: 0,
        output: ESTIMATED_OUTPUT_TOKENS,
      }),
    runSingle: async (request) => {
      if (config.apiKey === undefined) {
        throw new Error("the Anthropic adapter has no api key configured");
      }

      try {
        const response = await llmFetch(`${root}/v1/messages`, {
          body: JSON.stringify({
            model: config.model,
            max_tokens: SINGLE_MAX_TOKENS,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: Buffer.from(request.pdf).toString("base64"),
                    },
                  },
                  { type: "text", text: request.user },
                ],
              },
            ],
          }),
          headers: headers(),
          idempotent: false,
          label: "/v1/messages",
          method: "POST",
          ...retryPolicy(config),
        });

        const body: unknown = await response.json();

        return recordedMessageCall(messageSchema.parse(body), "resume");
      } catch (error) {
        recordFailedCall("resume", config.model);
        logError("llm.resume", error);

        throw error;
      }
    },
    estimateStructuredCostMicros: (request) =>
      strictCostMicrosFor(config.model, {
        input:
          Math.ceil(request.system.length / CHARS_PER_TOKEN) +
          Math.ceil((request.cachePrefix?.length ?? 0) / CHARS_PER_TOKEN) +
          Math.ceil(request.user.length / CHARS_PER_TOKEN),
        cacheRead: 0,
        cacheWrite: 0,
        output: ESTIMATED_OUTPUT_TOKENS,
      }),
    runStructured: async (request) => {
      if (config.apiKey === undefined) {
        throw new Error("the Anthropic adapter has no api key configured");
      }

      try {
        const response = await llmFetch(`${root}/v1/messages`, {
          body: JSON.stringify({
            model: config.model,
            max_tokens: SINGLE_MAX_TOKENS,
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            messages: [
              { role: "user", content: messageContent(request.cachePrefix, request.user) },
            ],
            output_config: { format: { type: "json_schema", schema: request.schema } },
          }),
          headers: headers(),
          idempotent: false,
          label: "/v1/messages",
          method: "POST",
          ...retryPolicy(config),
        });

        const body: unknown = await response.json();

        return recordedMessageCall(messageSchema.parse(body), request.purpose);
      } catch (error) {
        recordFailedCall(request.purpose, config.model);
        logError("llm.structured", error);

        throw error;
      }
    },
  };

  return port;
}
