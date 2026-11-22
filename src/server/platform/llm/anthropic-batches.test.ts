import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";

import { z } from "zod";

import { createAnthropicBatchProvider } from "./anthropic-batches.ts";

import type { IncomingHttpHeaders, Server } from "node:http";

const addressSchema = z.object({ port: z.number().int().positive() });

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

async function startResultsServer() {
  const headersSeen: IncomingHttpHeaders[] = [];

  const server = createServer((request, response) => {
    headersSeen.push(request.headers);
    response.writeHead(200, { "content-type": "application/x-jsonl" });
    response.end(`${RESULT_LINE}\n`);
  });

  servers.push(server);

  return await new Promise<{ url: string; headersSeen: IncomingHttpHeaders[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = addressSchema.safeParse(server.address());

      if (!address.success) {
        throw new Error("the results server did not bind a port");
      }

      resolve({ url: `http://127.0.0.1:${String(address.data.port)}`, headersSeen });
    });
  });
}

afterEach(() => {
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
});
