import { describe, expect, test } from "bun:test";

import type {
  LlmBatchCall,
  LlmPort,
  LlmRequest,
  LlmSingleCall,
  LlmSingleRequest,
  LlmStructuredCall,
  LlmStructuredRequest,
} from "../platform/ports/llm.ts";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { users } from "../platform/db/schema.ts";
import { LlmHttpError } from "../platform/llm/http.ts";
import { ungatedSpend } from "../billing/spend.ts";

Bun.env.BETTER_AUTH_SECRET ??= "classify-llm-test-secret-1234";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(3)).toString("base64");

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { classifyWithLlm } = await import("./classify-llm.ts");

const NOW = 1_800_000_000_000;

const testClock = { now: () => NOW };

/** Mirrors the provider: a custom_id over 64 characters rejects the whole batch with a 400. */
class FakeLlm implements LlmPort {
  readonly batchCalls: LlmRequest[][] = [];

  estimateBatchCostMicros(requests: readonly LlmRequest[]) {
    return requests.length * 100;
  }

  async runBatch(requests: readonly LlmRequest[]) {
    await Promise.resolve();
    this.batchCalls.push([...requests]);

    const tooLong = requests.find((request) => request.customId.length > 64);

    if (tooLong !== undefined) {
      throw new LlmHttpError({
        attempts: 1,
        detail: JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "requests.0.custom_id: String should have at most 64 characters",
          },
        }),
        label: "/v1/messages/batches",
        status: 400,
        timedOut: false,
      });
    }

    return requests.map(
      (request) =>
        ({
          cachedTokens: 0,
          cacheWriteTokens: 0,
          costMicros: 100,
          customId: request.customId,
          inputTokens: 100,
          model: "claude-haiku-5-5",
          outputTokens: 50,
          result: { ok: true, value: { classification: "rejection" } },
        }) satisfies LlmBatchCall,
    );
  }

  estimateSingleCostMicros() {
    return 100;
  }

  async runSingle(_request: LlmSingleRequest): Promise<LlmSingleCall> {
    await Promise.resolve();

    return {
      cachedTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 0,
      inputTokens: 0,
      model: "claude-haiku-5-5",
      outputTokens: 0,
      text: null,
    };
  }

  estimateStructuredCostMicros() {
    return 100;
  }

  async runStructured(_request: LlmStructuredRequest): Promise<LlmStructuredCall> {
    await Promise.resolve();

    return {
      cachedTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 0,
      inputTokens: 0,
      model: "claude-haiku-5-5",
      outputTokens: 0,
      text: null,
    };
  }
}

function fresh() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "person@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Person",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  return { db, sqlite };
}

describe("email classification batch", () => {
  test("keeps the custom_id within 64 characters and still maps a long Message-ID's reply back", async () => {
    const { db } = fresh();
    const messageId = `<${"m".repeat(80)}@mail.example.test>`;

    expect(messageId.length).toBeGreaterThan(64);

    const llm = new FakeLlm();

    const classification = await classifyWithLlm(
      { clock: testClock, db, llm, spendGate: ungatedSpend },
      {
        messageId,
        subject: "Your interview with Acme",
        text: "We would like to schedule a call next week.",
        userId: "user-1",
      },
    );

    const requests = llm.batchCalls.flat();

    expect(requests).toHaveLength(1);
    expect(requests.every((request) => request.customId.length <= 64)).toBe(true);
    expect(new Set(requests.map((request) => request.customId)).size).toBe(requests.length);
    expect(classification).toBe("rejection");
  });
});
