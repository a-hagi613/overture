import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";

import { z } from "zod";

import { openDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";

import { createAnthropicBatchProvider } from "./anthropic-batches.ts";
import { createLlmBatchRow, findLlmBatch, recordLlmBatchSubmission } from "./batch-store.ts";
import { createDurableBatches } from "./durable-batches.ts";

const addressSchema = z.object({ port: z.number().int().positive() });

const NOW = Date.UTC(2026, 10, 27, 9, 0, 0);
const clock = { now: () => NOW };

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

function freshDatabase() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function submittedBatchRecord(db: ReturnType<typeof freshDatabase>["db"]) {
  const { record } = createLlmBatchRow(db, clock, {
    id: "batch-record-1",
    inputRevisionHash: "hash-1",
    model: "claude-haiku-5-5",
  });

  recordLlmBatchSubmission(db, clock, record.id, {
    batchId: "batch-1",
    expiresAt: NOW + 86_400_000,
  });

  return record.id;
}

function durableBatches(db: ReturnType<typeof freshDatabase>["db"], baseUrl: string) {
  return createDurableBatches({
    clock,
    db,
    maxWaitMs: 60_000,
    model: "claude-haiku-5-5",
    pollIntervalMs: 1000,
    provider: createAnthropicBatchProvider({
      apiKey: "revoked-key",
      baseUrl,
      maxAttempts: 1,
      model: "claude-haiku-5-5",
    }),
  });
}

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }

  for (const server of servers.splice(0)) {
    server.close();
  }
});

test("a revoked credential fails the batch once instead of polling it for a day", async () => {
  const { db, sqlite } = freshDatabase();

  try {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "invalid x-api-key" } }));
    });

    const recordId = submittedBatchRecord(db);
    const outcome = await durableBatches(db, baseUrl).pollOnce(recordId);

    expect(outcome).toEqual({ kind: "settled" });
    expect(findLlmBatch(db, recordId)?.status).toBe("failed");
    expect(findLlmBatch(db, recordId)?.lastError).toContain("401");
  } finally {
    sqlite.close();
  }
});

test("a transient 500 keeps the batch recorded and polled", async () => {
  const { db, sqlite } = freshDatabase();

  try {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "internal error" } }));
    });

    const recordId = submittedBatchRecord(db);
    const outcome = await durableBatches(db, baseUrl).pollOnce(recordId);

    expect(outcome).toEqual({ delayMs: 1000, kind: "wait" });
    expect(findLlmBatch(db, recordId)?.status).toBe("in_progress");
    expect(findLlmBatch(db, recordId)?.lastError).toContain("500");
  } finally {
    sqlite.close();
  }
});
