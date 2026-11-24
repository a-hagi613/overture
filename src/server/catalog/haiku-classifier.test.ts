import { describe, expect, test } from "bun:test";

import { createHaikuBatchClassifier } from "./haiku-classifier.ts";

const BASE = "https://api.anthropic.test";

function resultLine(text: string) {
  return JSON.stringify({
    custom_id: "classify-0",
    result: {
      type: "succeeded",
      message: {
        content: [{ type: "text", text }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      },
    },
  });
}

function fakeFetch(lines: readonly string[]) {
  return async (url: string) => {
    await Promise.resolve();

    if (url.endsWith("/v1/messages/batches")) {
      return Response.json({ id: "batch-1", processing_status: "in_progress" });
    }

    if (url.endsWith("/v1/messages/batches/batch-1")) {
      return Response.json({
        id: "batch-1",
        processing_status: "ended",
        results_url: `${BASE}/results/batch-1`,
      });
    }

    return new Response(lines.join("\n"), { status: 200 });
  };
}

const ONE_ITEM = [
  {
    department: null,
    jobCategory: null,
    key: "k1",
    language: "en",
    title: "Quantum Basket Weaver",
  },
];

describe("createHaikuBatchClassifier", () => {
  test("submits a batch, parses strict JSON and prices it with the batch table", async () => {
    const classify = createHaikuBatchClassifier({
      apiKey: "test-key",
      baseUrl: BASE,
      fetchImpl: fakeFetch([
        resultLine(
          JSON.stringify({
            results: [
              {
                esco_code: "2512.1",
                index: 0,
                primary_category: "Software Engineering",
                primary_role: "Software Engineer",
                secondary_roles: ["Data Engineer", "Not A Role"],
                seniority: "mid",
              },
            ],
          }),
        ),
      ]),
      pollIntervalMs: 0,
    });

    const result = await classify(ONE_ITEM);

    expect(result.resolved.get("k1")?.category).toBe("Software Engineering");
    expect(result.resolved.get("k1")?.role).toBe("Software Engineer");
    expect(result.resolved.get("k1")?.secondaryRoles).toHaveLength(1);
    expect(result.resolved.get("k1")?.escoCode).toBe("2512.1");
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(200);
    expect(result.costMicros).toBeCloseTo((1000 * 50_000 + 200 * 250_000) / 1_000_000);
  });

  test("drops an unknown role, an unknown category and an unknown ESCO code", async () => {
    const classify = createHaikuBatchClassifier({
      apiKey: "test-key",
      baseUrl: BASE,
      fetchImpl: fakeFetch([
        resultLine(
          JSON.stringify({
            results: [
              {
                esco_code: "9999.9",
                index: 0,
                primary_category: "Software Engineering",
                primary_role: "Quantum Analyst",
                secondary_roles: [],
                seniority: null,
              },
            ],
          }),
        ),
      ]),
      pollIntervalMs: 0,
    });

    const result = await classify(ONE_ITEM);

    expect(result.resolved.size).toBe(0);
  });

  test("yields an empty result when the batch submit fails", async () => {
    const classify = createHaikuBatchClassifier({
      apiKey: "test-key",
      baseUrl: BASE,
      fetchImpl: async () => await Promise.resolve(new Response("nope", { status: 500 })),
      pollIntervalMs: 0,
    });

    const result = await classify(ONE_ITEM);

    expect(result.resolved.size).toBe(0);
    expect(result.costMicros).toBe(0);
  });
});
