import { z } from "zod";

import { ROLE_GROUPS } from "../../shared/tag-taxonomy.ts";

import { classificationKey } from "./classification-key.ts";

/**
 * The compressed cache object both the R2 path and the signed relay path read and write. It is small JSON (one entry
 * per distinct classification key) wrapped in zstd so the daily run moves kilobytes, not megabytes.
 */
export const CLASSIFICATION_CACHE_KEY = "catalog/title-class-cache.json.zst";

const cachedClassificationSchema = z.object({
  category: z.enum(ROLE_GROUPS),
  role: z.string().min(1),
  escoCode: z.string().nullable(),
  secondaryRoles: z
    .array(z.object({ category: z.enum(ROLE_GROUPS), role: z.string().min(1), score: z.number() }))
    .default([]),
  confidence: z.number(),
  source: z.enum(["esco", "embeddings", "haiku"]),
});

export type CachedClassification = z.infer<typeof cachedClassificationSchema>;

const cacheFileSchema = z.object({
  taxonomyVersion: z.string().min(1),
  entries: z.record(z.string(), cachedClassificationSchema),
});

export interface ClassificationCache {
  readonly taxonomyVersion: string;
  readonly entries: Readonly<Record<string, CachedClassification>>;
}

/**
 * @param taxonomyVersion The ESCO dataset version, so a vocabulary change invalidates every entry.
 * @returns An empty cache.
 */
export function emptyClassificationCache(taxonomyVersion: string): ClassificationCache {
  return { taxonomyVersion, entries: {} };
}

/**
 * The key task decision 4 asks for: `(class_title_norm, dept_norm, taxonomy_version)`. The version lives in the cache
 * header, so the per-entry key is the two normalized halves.
 * @param title The raw title.
 * @param department The raw department.
 * @param taxonomyVersion The ESCO dataset version.
 * @returns The cache key.
 */
export function classificationCacheKey(
  title: string,
  department: string | null,
  taxonomyVersion: string,
) {
  const { titleNorm, deptNorm } = classificationKey(title, department);

  return `${taxonomyVersion}|${titleNorm}|${deptNorm}`;
}

/**
 * @param cache The cache.
 * @param key A key from `classificationCacheKey`.
 * @returns The cached classification, or null.
 */
export function getCachedClassification(cache: ClassificationCache, key: string) {
  return cache.entries[key] ?? null;
}

/**
 * Adds or replaces entries, returning a new cache rather than mutating one the caller may still read.
 * @param cache The cache to extend.
 * @param updates The entries to add.
 * @returns The merged cache.
 */
export function mergeClassificationCache(
  cache: ClassificationCache,
  updates: Readonly<Record<string, CachedClassification>>,
) {
  return { taxonomyVersion: cache.taxonomyVersion, entries: { ...cache.entries, ...updates } };
}

/**
 * Parses a cache object. A corrupt or missing object is treated as empty: the cache is an optimization and must never
 * fail a daily run, which is exactly what makes the Day-1 404 safe.
 * @param bytes The (already decompressed) JSON bytes, or null.
 * @param taxonomyVersion The version the run expects.
 * @returns The parsed cache.
 */
export function parseClassificationCache(bytes: Uint8Array | null, taxonomyVersion: string) {
  if (bytes === null) {
    return emptyClassificationCache(taxonomyVersion);
  }

  try {
    const parsed = cacheFileSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));

    if (!parsed.success || parsed.data.taxonomyVersion !== taxonomyVersion) {
      return emptyClassificationCache(taxonomyVersion);
    }

    return parsed.data;
  } catch {
    return emptyClassificationCache(taxonomyVersion);
  }
}

/**
 * @param cache The cache to serialize.
 * @returns The zstd-compressed JSON object.
 */
export function serializeClassificationCache(cache: ClassificationCache) {
  const json = new TextEncoder().encode(`${JSON.stringify(cache)}\n`);

  return new Uint8Array(Bun.zstdCompressSync(json, { level: 12 })) as Uint8Array<ArrayBuffer>;
}

/**
 * @param bytes A compressed cache object.
 * @returns The JSON bytes.
 */
export function decompressClassificationCache(bytes: Uint8Array<ArrayBuffer>) {
  return new Uint8Array(Bun.zstdDecompressSync(bytes));
}

export { cachedClassificationSchema };
