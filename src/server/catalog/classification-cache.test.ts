import { describe, expect, test } from "bun:test";

import {
  classificationCacheKey,
  decompressClassificationCache,
  emptyClassificationCache,
  getCachedClassification,
  mergeClassificationCache,
  parseClassificationCache,
  serializeClassificationCache,
} from "./classification-cache.ts";

const VERSION = "1.2.1";

describe("classification cache", () => {
  test("round-trips entries through zstd", () => {
    const cache = mergeClassificationCache(emptyClassificationCache(VERSION), {
      "1.2.1|data engineer|engineering": {
        category: "Data & Analytics",
        confidence: 0.91,
        escoCode: "2511.3",
        role: "Data Engineer",
        secondaryRoles: [
          { category: "Software Engineering", role: "Backend Engineer", score: 0.8 },
        ],
        source: "embeddings",
      },
    });

    const parsed = parseClassificationCache(
      decompressClassificationCache(serializeClassificationCache(cache)),
      VERSION,
    );

    expect(parsed.entries["1.2.1|data engineer|engineering"]?.role).toBe("Data Engineer");
  });

  test("treats a missing object as empty, which is the Day-1 404", () => {
    expect(parseClassificationCache(null, VERSION)).toEqual(emptyClassificationCache(VERSION));
  });

  test("treats a corrupt object as empty instead of failing the run", () => {
    expect(parseClassificationCache(new TextEncoder().encode("not json"), VERSION).entries).toEqual(
      {},
    );
  });

  test("invalidates every entry when the taxonomy version changes", () => {
    const cache = mergeClassificationCache(emptyClassificationCache("1.2.0"), {
      "1.2.0|nurse|health": {
        category: "Healthcare",
        confidence: 1,
        escoCode: null,
        role: "Registered Nurse",
        secondaryRoles: [],
        source: "esco",
      },
    });

    expect(parseClassificationCache(serializeClassificationCache(cache), VERSION).entries).toEqual(
      {},
    );
  });

  test("keys on the version, the normalized title and the department", () => {
    const key = classificationCacheKey(
      "Senior Data Engineer (m/w/d) - Berlin",
      "Engineering",
      VERSION,
    );

    expect(key).toBe("1.2.1|senior data engineer|engineering");
    expect(getCachedClassification(emptyClassificationCache(VERSION), key)).toBeNull();
  });
});
