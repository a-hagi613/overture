import { describe, expect, test } from "bun:test";

import type { ClassificationCache } from "./classification-cache.ts";
import type { HaikuBatchClassifier } from "./haiku-classifier.ts";
import type { Tier2Prototypes } from "./classifier.ts";

import {
  classifyTier1,
  classifyWithEmbeddings,
  DEFAULT_EMBEDDING_THRESHOLDS,
  runClassificationPipeline,
} from "./classifier.ts";
import { emptyClassificationCache, mergeClassificationCache } from "./classification-cache.ts";

function item(title: string, key = title, department: string | null = null) {
  return { department, jobCategory: null, key, language: "en", title };
}

describe("classifyTier1", () => {
  test("classifies English administrative titles without a model", () => {
    for (const title of [
      "Executive Assistant",
      "Office Manager",
      "Administrative Assistant",
      "Receptionist",
      "Data Entry Clerk",
    ]) {
      const classification = classifyTier1(item(title));

      expect(classification?.category).toBe("Administrative");
      expect(classification?.source).toBe("esco");
    }
  });

  test("classifies a Japanese title through the multilingual rule hints", () => {
    const classification = classifyTier1(item("データベース管理者"));

    expect(classification?.category).toBe("DevOps & Infrastructure");
    expect(classification?.role).toBe("Database Administrator");
    expect(classification?.source).toBe("esco");
  });

  test("preserves the title when classifying", () => {
    const original = "Senior Backend Engineer (m/w/d) - Berlin";
    const classification = classifyTier1(item(original));

    expect(classification?.category).toBe("Software Engineering");
  });

  test("returns null for a title no tier can place", () => {
    expect(classifyTier1(item("Quantum Basket Weaver"))).toBeNull();
  });
});

const haiku: HaikuBatchClassifier = async (items) => {
  await Promise.resolve();

  return {
    costMicros: 120,
    inputTokens: 1000,
    outputTokens: 400,
    resolved: new Map(
      items.map((entry) => [
        entry.key,
        {
          category: "Software Engineering" as const,
          escoCode: null,
          role: "Software Engineer",
          secondaryRoles: [],
          seniority: null,
        },
      ]),
    ),
  };
};

function prototypes() {
  return {
    occupations: [
      {
        category: "Software Engineering",
        code: "2512.1",
        role: "Backend Engineer",
        text: "software developer",
        vector: Float32Array.from([1, 0, 0]),
      },
      {
        category: "Communications & PR",
        code: "2641.1",
        role: "Copywriter",
        text: "copywriter",
        vector: Float32Array.from([0, 1, 0]),
      },
    ],
    roles: [
      {
        category: "Software Engineering",
        role: "Backend Engineer",
        text: "Backend Engineer (Software Engineering)",
        vector: Float32Array.from([1, 0, 0]),
      },
      {
        category: "Communications & PR",
        role: "Copywriter",
        text: "Copywriter (Communications & PR)",
        vector: Float32Array.from([0, 1, 0]),
      },
    ],
  } satisfies Tier2Prototypes;
}

describe("classifyWithEmbeddings", () => {
  test("accepts a confident top-1 with a clear margin and recovers the ESCO code", () => {
    const classification = classifyWithEmbeddings(
      Float32Array.from([1, 0, 0]),
      prototypes(),
      DEFAULT_EMBEDDING_THRESHOLDS,
    );

    expect(classification?.category).toBe("Software Engineering");
    expect(classification?.role).toBe("Backend Engineer");
    expect(classification?.escoCode).toBe("2512.1");
    expect(classification?.source).toBe("embeddings");
  });

  test("rejects a top-1 below the calibrated threshold", () => {
    const classification = classifyWithEmbeddings(
      Float32Array.from([0.7, 0.6, 0]),
      prototypes(),
      DEFAULT_EMBEDDING_THRESHOLDS,
    );

    expect(classification).toBeNull();
  });

  test("rejects a top-1 whose runner-up is too close", () => {
    const classification = classifyWithEmbeddings(
      Float32Array.from([0.8, 0.79, 0]),
      prototypes(),
      DEFAULT_EMBEDDING_THRESHOLDS,
    );

    expect(classification).toBeNull();
  });
});

describe("runClassificationPipeline", () => {
  test("runs cache, Tier 1 and Tier 3 in order and reports every counter", async () => {
    const cache: ClassificationCache = mergeClassificationCache(emptyClassificationCache("1.2.1"), {
      cached: {
        category: "Marketing",
        confidence: 0.9,
        escoCode: null,
        role: "Content Marketer",
        secondaryRoles: [],
        source: "embeddings",
      },
    });

    const haikuClassifier = haiku;

    const output = await runClassificationPipeline({
      cache,
      crossBoardDupesRemoved: 7,
      embedder: null,
      haiku: haikuClassifier,
      items: [
        item("Content marketing manager", "cached"),
        item("Executive Assistant", "admin"),
        item("Software developer", "developer"),
        item("Quantum Basket Weaver", "unknown"),
      ],
      totalPostings: 40,
    });

    expect(output.results.size).toBe(4);
    expect(output.report.cache_hit).toBe(1);
    expect(output.report.tier1_esco_rules).toBe(2);
    expect(output.report.tier3_haiku_batch_sent).toBe(1);
    expect(output.report.tier3_haiku_resolved).toBe(1);
    expect(output.report.still_untagged).toBe(0);
    expect(output.report.cross_board_dupes_removed).toBe(7);
    expect(output.report.tier3_cost_usd).toBeCloseTo(0.00012);
    expect(Object.keys(output.updates)).toEqual(["unknown"]);
  });

  test("leaves an unresolved pair untagged when no tier can answer", async () => {
    const output = await runClassificationPipeline({
      cache: emptyClassificationCache("1.2.1"),
      crossBoardDupesRemoved: 0,
      embedder: null,
      haiku: null,
      items: [item("Quantum Basket Weaver")],
      totalPostings: 1,
    });

    expect(output.report.still_untagged).toBe(1);
    expect(output.results.size).toBe(0);
  });
});
