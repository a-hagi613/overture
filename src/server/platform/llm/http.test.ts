import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";

import { z } from "zod";

import { LlmHttpError, llmFetch } from "./http.ts";

const addressSchema = z.object({ port: z.number().int().positive() });

const servers: Server[] = [];
const sockets: Socket[] = [];

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

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer((request, response) => {
    handler(request, response);
  });

  server.on("connection", (socket) => {
    sockets.push(socket);
  });

  return await listen(server);
}

async function startStalledServer() {
  const server = createServer(() => null);

  server.on("connection", (socket) => {
    sockets.push(socket);
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
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }

  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("llmFetch", () => {
  test("a non-idempotent call is never resent after a network failure", async () => {
    const url = await startStalledServer();

    const failure = await failureOf(
      llmFetch(url, {
        headers: {},
        idempotent: false,
        label: "/v1/messages",
        maxAttempts: 3,
        method: "POST",
        retryBaseMs: 1,
        timeoutMs: 40,
      }),
    );

    expect(failure).toBeInstanceOf(LlmHttpError);
    expect(failure?.attempts).toBe(1);
  });

  test("a non-idempotent call retries only a 429 the provider refused before processing", async () => {
    let attempts = 0;

    const url = await startServer((_request, response) => {
      attempts += 1;

      if (attempts === 1) {
        response.writeHead(429, { "content-type": "application/json", "retry-after": "0" });
        response.end(JSON.stringify({ error: { message: "rate limited" } }));

        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });

    const response = await llmFetch(url, {
      headers: {},
      idempotent: false,
      label: "/v1/messages",
      maxAttempts: 3,
      method: "POST",
      retryBaseMs: 1,
    });

    expect(response.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  test("an idempotent call retries a 503 and stops at its attempt bound", async () => {
    let attempts = 0;

    const url = await startServer((_request, response) => {
      attempts += 1;
      response.writeHead(503, { "content-type": "application/json", "retry-after": "0" });
      response.end(JSON.stringify({ error: { message: "overloaded" } }));
    });

    const failure = await failureOf(
      llmFetch(url, {
        headers: {},
        idempotent: true,
        label: "batch status",
        maxAttempts: 2,
        method: "GET",
        retryBaseMs: 1,
      }),
    );

    expect(failure?.status).toBe(503);
    expect(attempts).toBe(2);
  });
});
