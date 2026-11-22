import { Buffer } from "node:buffer";

import { z } from "zod";

import type { LlmBatchCall, LlmPort, LlmRequest } from "../ports/llm.ts";
import { batchPricesFor } from "./models.ts";

const API_VERSION = "2023-06-01";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 360;
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

function costMicrosFor(model: string, usage: TokenUsage) {
  const prices = batchPricesFor(model);

  const micros =
    (usage.input * prices.inputPerMillionTokens +
      usage.cacheRead * prices.cacheReadPerMillionTokens +
      usage.cacheWrite * prices.cacheWritePerMillionTokens +
      usage.output * prices.outputPerMillionTokens) /
    1_000_000;

  return Math.ceil(micros);
}

function estimatedUsageFor(request: LlmRequest) {
  return {
    input: Math.ceil((request.system.length + request.user.length) / CHARS_PER_TOKEN),
    cacheRead: 0,
    cacheWrite: 0,
    output: ESTIMATED_OUTPUT_TOKENS,
  };
}

async function waitMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJson(text: string) {
  const value: unknown = JSON.parse(text);

  return value;
}

export interface AnthropicLlmConfig {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

export function createAnthropicLlmPort(config: AnthropicLlmConfig) {
  const root = config.baseUrl.replace(/\/+$/u, "");

  const headers = () => ({
    "x-api-key": config.apiKey ?? "",
    "anthropic-version": API_VERSION,
    "content-type": "application/json",
  });

  async function call(path: string, init: RequestInit) {
    const response = await fetch(`${root}${path}`, init);

    if (!response.ok) {
      const body = await response.text();

      throw new Error(`Anthropic API ${String(response.status)} on ${path}: ${body.slice(0, 500)}`);
    }

    return response;
  }

  async function callJson(path: string) {
    const response = await call(path, { headers: headers() });
    const body: unknown = await response.json();

    return body;
  }

  async function createBatch(requests: readonly LlmRequest[]) {
    const response = await call("/v1/messages/batches", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        requests: requests.map((request) => ({
          custom_id: request.customId,
          params: {
            model: config.model,
            max_tokens: MAX_TOKENS,
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: request.user }],
            output_config: { format: { type: "json_schema", schema: request.schema } },
          },
        })),
      }),
    });

    const body: unknown = await response.json();

    return batchSchema.parse(body);
  }

  async function awaitBatchEnded(batchId: string, attemptsLeft: number) {
    const batch = batchSchema.parse(await callJson(`/v1/messages/batches/${batchId}`));

    if (batch.processing_status === "ended") {
      return batch;
    }

    if (batch.processing_status === "canceling") {
      throw new Error(`batch ${batchId} is canceling and will not complete`);
    }

    if (attemptsLeft <= 1) {
      throw new Error(
        `batch ${batchId} did not end within ${String(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS)}ms`,
      );
    }

    await waitMs(POLL_INTERVAL_MS);

    return awaitBatchEnded(batchId, attemptsLeft - 1);
  }

  async function fetchResultLines(resultsUrl: string) {
    const response = await fetch(resultsUrl, { headers: headers() });

    if (!response.ok) {
      throw new Error(
        `Anthropic API ${String(response.status)} on the batch results: ${resultsUrl}`,
      );
    }

    const body = await response.text();

    return body
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => resultLineSchema.parse(parseJson(line)));
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

  const port: LlmPort = {
    estimateBatchCostMicros: (requests) =>
      requests.reduce(
        (total, request) => total + costMicrosFor(config.model, estimatedUsageFor(request)),
        0,
      ),
    runBatch: async (requests) => {
      if (config.apiKey === undefined) {
        throw new Error("the Anthropic adapter has no api key configured");
      }

      if (requests.length === 0) {
        return [];
      }

      const created = await createBatch(requests);
      const ended = await awaitBatchEnded(created.id, MAX_POLL_ATTEMPTS);

      if (ended.results_url === null) {
        throw new Error(`batch ${ended.id} ended without a results url`);
      }

      const lines = await fetchResultLines(ended.results_url);

      return lines.map((line) => callFor(line));
    },
    estimateSingleCostMicros: (request) =>
      costMicrosFor(config.model, {
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

      const response = await call("/v1/messages", {
        method: "POST",
        headers: headers(),
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
      });

      const body: unknown = await response.json();

      const message = messageSchema.parse(body);

      return {
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
    },
  };

  return port;
}
