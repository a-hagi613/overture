import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { Socket } from "node:net";

import { z } from "zod";

import { createAnthropicBatchProvider } from "./anthropic-batches.ts";
import { LlmHttpError } from "./http.ts";

import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";

const addressSchema = z.object({ port: z.number().int().positive() });

const BATCH_JSON = JSON.stringify({
  created_at: "2026-11-27T09:00:00.000Z",
  expires_at: "2026-11-28T09:00:00.000Z",
  id: "batch-1",
  processing_status: "ended",
  request_counts: { canceled: 0, errored: 0, expired: 0, processing: 0, succeeded: 1 },
  results_url: null,
  type: "message_batch",
});

const RESULT_LINE = JSON.stringify({
  custom_id: "request-1",
  result: {
    type: "succeeded",
    message: {
      id: "message-1",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text: "{}" }],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 5,
      },
    },
  },
});

const servers: Server[] = [];
const openSockets: Socket[] = [];

async function listen(server: Server) {
  servers.push(server);

  return await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = addressSchema.safeParse(server.address());

      if (!address.success) {
        throw new Error("the fixture server did not bind a port");
      }

      resolve(`http://127.0.0.1:${String(address.data.port)}`);
    });
  });
}

async function startResultsServer() {
  const headersSeen: IncomingHttpHeaders[] = [];

  const server = createServer((request, response) => {
    headersSeen.push(request.headers);
    response.writeHead(200, { "content-type": "application/x-jsonl" });
    response.end(`${RESULT_LINE}\n`);
  });

  const url = await listen(server);

  return { headersSeen, url };
}

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer((request, response) => {
    handler(request, response);
  });

  const url = await listen(server);

  return url;
}

async function startStalledServer() {
  const server = createServer(() => null);

  server.on("connection", (socket) => {
    openSockets.push(socket);
  });

  return await listen(server);
}

async function failureOf(run: Promise<unknown>) {
  try {
    await run;

    return null;
  } catch (error) {
    return error instanceof LlmHttpError ? error : null;
  }
}

afterEach(() => {
  for (const socket of openSockets.splice(0)) {
    socket.destroy();
  }

  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("the Anthropic batch provider", () => {
  test("sends the api key to a results url on the configured origin", async () => {
    const api = await startResultsServer();

    const provider = createAnthropicBatchProvider({
      baseUrl: api.url,
      apiKey: "secret-api-key",
      model: "claude-haiku-5-5",
    });

    const calls = await provider.results(`${api.url}/v1/messages/batches/batch-1/results`);

    expect(calls.length).toBe(1);
    expect(api.headersSeen[0]?.["x-api-key"]).toBe("secret-api-key");
  });

  test("never sends the api key to a results url on another origin", async () => {
    const api = await startResultsServer();
    const elsewhere = await startResultsServer();

    const provider = createAnthropicBatchProvider({
      baseUrl: api.url,
      apiKey: "secret-api-key",
      model: "claude-haiku-5-5",
    });

    const calls = await provider.results(`${elsewhere.url}/v1/messages/batches/batch-1/results`);

    expect(calls.length).toBe(1);
    expect(elsewhere.headersSeen[0]?.["x-api-key"]).toBeUndefined();
  });

  test("aborts a stalled upstream at the timeout instead of holding the job open", async () => {
    const baseUrl = await startStalledServer();

    const provider = createAnthropicBatchProvider({
      baseUrl,
      apiKey: "secret-api-key",
      maxAttempts: 1,
      model: "claude-haiku-5-5",
      timeoutMs: 50,
    });

    const failure = await failureOf(provider.retrieve("batch-1"));

    expect(failure).toBeInstanceOf(LlmHttpError);
    expect(failure?.timedOut).toBe(true);
    expect(failure?.message).toContain("no response within 50 ms");
  });

  test("retries a transient 503 with jitter and then returns the batch", async () => {
    let attempts = 0;

    const baseUrl = await startServer((_request, response) => {
      attempts += 1;

      if (attempts === 1) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "overloaded" } }));

        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(BATCH_JSON);
    });

    const provider = createAnthropicBatchProvider({
      baseUrl,
      apiKey: "secret-api-key",
      model: "claude-haiku-5-5",
      retryBaseMs: 1,
    });

    const batch = await provider.retrieve("batch-1");

    expect(batch.id).toBe("batch-1");
    expect(attempts).toBe(2);
  });

  test("does not retry a permanent 400", async () => {
    let attempts = 0;

    const baseUrl = await startServer((_request, response) => {
      attempts += 1;
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "bad request" } }));
    });

    const provider = createAnthropicBatchProvider({
      baseUrl,
      apiKey: "secret-api-key",
      model: "claude-haiku-5-5",
      retryBaseMs: 1,
    });

    const failure = await failureOf(provider.retrieve("batch-1"));

    expect(failure?.status).toBe(400);
    expect(attempts).toBe(1);
  });

  test("records the tokens of a reply whose model has no rate card instead of failing", async () => {
    const unpaidLine = JSON.stringify({
      custom_id: "request-1",
      result: {
        message: {
          content: [{ text: "{}", type: "text" }],
          id: "message-1",
          model: "claude-unpriced-9",
          usage: {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            input_tokens: 10,
            output_tokens: 5,
          },
        },
        type: "succeeded",
      },
    });

    const baseUrl = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/x-jsonl" });
      response.end(`${unpaidLine}\n`);
    });

    const provider = createAnthropicBatchProvider({
      baseUrl,
      apiKey: "secret-api-key",
      model: "claude-haiku-5-5",
    });

    const calls = await provider.results(`${baseUrl}/v1/messages/batches/batch-1/results`);

    expect(calls[0]?.inputTokens).toBe(10);
    expect(calls[0]?.outputTokens).toBe(5);
    expect(calls[0]?.costMicros).toBe(0);
    expect(calls[0]?.result.ok).toBe(true);
  });
});
