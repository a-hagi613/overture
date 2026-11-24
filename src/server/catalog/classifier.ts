import type { RoleGroup } from "../../shared/tag-taxonomy.ts";
import type { CachedClassification, ClassificationCache } from "./classification-cache.ts";
import type { TextEmbedder } from "./embedder.ts";
import type { AmbiguousClassificationItem, HaikuBatchClassifier } from "./haiku-classifier.ts";
import type { TaggingReport } from "./tagging-report.ts";

import { classificationTitle, normalizeClassificationText } from "./classification-key.ts";
import { classificationCacheKey } from "./classification-cache.ts";
import { embedInBatches, cosineSimilarity } from "./embedder.ts";
import { granularRoleFor, multilingualRoleHint } from "./esco-mapping.ts";
import {
  ESCO_VERSION,
  categoryHintFromText,
  classifyWithEsco,
  escoPrototypes,
  escoRolePrototypes,
} from "./esco-taxonomy.ts";

export interface SecondaryRole {
  readonly category: RoleGroup;
  readonly role: string;
  readonly score: number;
}

export interface Classification {
  readonly category: RoleGroup;
  readonly role: string;
  readonly escoCode: string | null;
  readonly secondaryRoles: readonly SecondaryRole[];
  readonly confidence: number;
  readonly source: "esco" | "embeddings" | "haiku";
}

export function classifyTier1(item: AmbiguousClassificationItem) {
  const title = classificationTitle(item.title);

  const text = normalizeClassificationText(
    `${title} ${item.department ?? ""} ${item.jobCategory ?? ""}`,
  );

  const granular = granularRoleFor(text);

  if (granular !== null) {
    return {
      category: granular.category,
      role: granular.role,
      escoCode: null,
      secondaryRoles: [],
      confidence: 0.65,
      source: "esco",
    } satisfies Classification;
  }

  const esco = classifyWithEsco(title);

  if (esco !== null) {
    return {
      category: esco.category,
      role: esco.role,
      escoCode: esco.escoCode,
      secondaryRoles: [],
      confidence: 1,
      source: "esco",
    } satisfies Classification;
  }

  const multilingual = multilingualRoleHint(text);

  if (multilingual !== null) {
    return {
      category: multilingual.category,
      role: multilingual.role,
      escoCode: null,
      secondaryRoles: [],
      confidence: 0.6,
      source: "esco",
    } satisfies Classification;
  }

  const hint = categoryHintFromText(item.jobCategory) ?? categoryHintFromText(item.department);

  if (hint !== null) {
    return {
      category: hint,
      role: hint,
      escoCode: null,
      secondaryRoles: [],
      confidence: 0.35,
      source: "esco",
    } satisfies Classification;
  }

  return null;
}

export interface EmbeddingThresholds {
  readonly acceptTop1: number;
  readonly acceptMargin: number;
  readonly strongTop1: number;
  readonly secondaryMin: number;
  readonly escoMin: number;
}

/**
 * The calibrated Tier-2 thresholds. A role embedding's runner-up is usually a near-synonym, so the fixture shows
 * margins of 0.001–0.06 while the top-1 score is 0.84–0.93; the strong-match bypass keeps the 0.06 margin rule but
 * accepts a 0.86+ top-1 on its own. On the built-in EN/DE/FR/ES/JP fixture this classifies 16 of 20 titles with a
 * 100 % category precision, and the ETL can retune both numbers from the command line.
 */
export const DEFAULT_EMBEDDING_THRESHOLDS: EmbeddingThresholds = {
  acceptTop1: 0.78,
  acceptMargin: 0.06,
  strongTop1: 0.86,
  secondaryMin: 0.74,
  escoMin: 0.74,
};

export interface EmbeddedPrototype {
  readonly category: RoleGroup;
  readonly role: string;
  readonly text: string;
  readonly vector: Float32Array;
}

export interface EmbeddedOccupationPrototype extends EmbeddedPrototype {
  readonly code: string;
}

export interface Tier2Prototypes {
  readonly roles: readonly EmbeddedPrototype[];
  readonly occupations: readonly EmbeddedOccupationPrototype[];
}

/**
 * Embeds the role and occupation prototypes once. The role prototypes are the fast first pass; the occupation
 * prototypes are searched only inside the accepted role to recover the Level-3 code.
 * @param embedder The embedding port.
 * @returns The embedded prototypes.
 */
export async function buildTier2Prototypes(embedder: TextEmbedder) {
  const rolePrototypes = escoRolePrototypes();
  const occupationPrototypes = escoPrototypes();

  const roleVectors = await embedInBatches(
    embedder,
    rolePrototypes.map((prototype) => `passage: ${prototype.text}`),
  );

  const occupationVectors = await embedInBatches(
    embedder,
    occupationPrototypes.map((prototype) => `passage: ${prototype.text}`),
  );

  return {
    roles: rolePrototypes.map((prototype, index) => ({
      category: prototype.category,
      role: prototype.role,
      text: prototype.text,
      vector: roleVectors[index] ?? new Float32Array(0),
    })),
    occupations: occupationPrototypes.map((prototype, index) => ({
      category: prototype.category,
      code: prototype.code,
      role: prototype.role,
      text: prototype.text,
      vector: occupationVectors[index] ?? new Float32Array(0),
    })),
  };
}

function rankedRoles(vector: Float32Array, prototypes: Tier2Prototypes) {
  return prototypes.roles
    .map((prototype) => ({
      category: prototype.category,
      role: prototype.role,
      score: cosineSimilarity(vector, prototype.vector),
    }))
    .toSorted((left, right) => right.score - left.score);
}

function escalonCodeFor(
  vector: Float32Array,
  role: string,
  prototypes: Tier2Prototypes,
  threshold: number,
) {
  const candidates = prototypes.occupations.filter((prototype) => prototype.role === role);
  let best: { code: string; score: number } | null = null;

  for (const candidate of candidates) {
    const score = cosineSimilarity(vector, candidate.vector);

    if (best === null || score > best.score) {
      best = { code: candidate.code, score };
    }
  }

  return best !== null && best.score >= threshold ? best.code : null;
}

/**
 * The Tier-2 answer for one embedded query.
 * @param vector The query embedding.
 * @param prototypes The embedded role and occupation prototypes.
 * @param thresholds The calibrated thresholds.
 * @returns The classification, or null when the top match is not confident enough.
 */
export function classifyWithEmbeddings(
  vector: Float32Array,
  prototypes: Tier2Prototypes,
  thresholds: EmbeddingThresholds = DEFAULT_EMBEDDING_THRESHOLDS,
) {
  const ranked = rankedRoles(vector, prototypes);
  const [top] = ranked;

  if (top === undefined || top.score < thresholds.acceptTop1) {
    return null;
  }

  const runnerUp = ranked[1]?.score ?? 0;

  const confident =
    top.score >= thresholds.strongTop1 || top.score - runnerUp >= thresholds.acceptMargin;

  if (top.score < thresholds.acceptTop1 || !confident) {
    return null;
  }

  const secondaryRoles = ranked
    .slice(1)
    .filter((role) => role.score >= thresholds.secondaryMin)
    .slice(0, 2);

  return {
    category: top.category,
    role: top.role,
    escoCode: escalonCodeFor(vector, top.role, prototypes, thresholds.escoMin),
    secondaryRoles,
    confidence: top.score,
    source: "embeddings",
  } satisfies Classification;
}

function queryText(item: AmbiguousClassificationItem) {
  return `query: ${classificationTitle(item.title)} ${item.department ?? ""} ${item.jobCategory ?? ""}`;
}

/**
 * Classifies a batch with Tier 2.
 * @param items The unresolved items.
 * @param prototypes The embedded prototypes.
 * @param embedder The embedding port.
 * @param thresholds The calibrated thresholds.
 * @returns The accepted classifications by key.
 */
export async function classifyBatchWithEmbeddings(
  items: readonly AmbiguousClassificationItem[],
  prototypes: Tier2Prototypes,
  embedder: TextEmbedder,
  thresholds: EmbeddingThresholds = DEFAULT_EMBEDDING_THRESHOLDS,
) {
  const vectors = await embedInBatches(
    embedder,
    items.map((item) => queryText(item)),
  );

  const accepted = new Map<string, Classification>();

  for (const [index, item] of items.entries()) {
    const vector = vectors[index];

    if (vector === undefined) {
      continue;
    }

    const classification = classifyWithEmbeddings(vector, prototypes, thresholds);

    if (classification !== null) {
      accepted.set(item.key, classification);
    }
  }

  return accepted;
}

export interface RunClassificationInput {
  readonly items: readonly AmbiguousClassificationItem[];
  readonly cache: ClassificationCache;
  readonly embedder: TextEmbedder | null;
  readonly haiku: HaikuBatchClassifier | null;
  readonly totalPostings: number;
  readonly crossBoardDupesRemoved: number;
  readonly thresholds?: EmbeddingThresholds;
}

export interface RunClassificationOutput {
  readonly results: ReadonlyMap<string, Classification>;
  readonly updates: Readonly<Record<string, CachedClassification>>;
  readonly report: TaggingReport;
}

/**
 * Runs the three tiers over the unique `(class_title_norm, dept_norm)` pairs. Cache first, then the free ESCO/rules
 * tier, then local embeddings, then the Haiku tail. Only the expensive tiers are written back to the cache.
 * @param input The pairs, cache, embedder, Haiku classifier and run counters.
 * @returns The classifications, the cache updates and the structured report.
 */
export async function runClassificationPipeline(input: RunClassificationInput) {
  const results = new Map<string, Classification>();
  const updates: Record<string, CachedClassification> = {};

  const report: TaggingReport = {
    total_postings: input.totalPostings,
    cross_board_dupes_removed: input.crossBoardDupesRemoved,
    unique_title_dept_pairs: input.items.length,
    cache_hit: 0,
    tier1_esco_rules: 0,
    tier2_embeddings: 0,
    tier3_haiku_batch_sent: 0,
    tier3_haiku_resolved: 0,
    still_untagged: 0,
    input_tokens: 0,
    output_tokens: 0,
    tier3_cost_usd: 0,
  };

  const unresolved: AmbiguousClassificationItem[] = [];

  for (const item of input.items) {
    const cached = input.cache.entries[item.key];

    if (cached !== undefined && input.cache.taxonomyVersion === ESCO_VERSION) {
      results.set(item.key, { ...cached, secondaryRoles: [...cached.secondaryRoles] });
      report.cache_hit += 1;
      continue;
    }

    const tier1Result = classifyTier1(item);

    if (tier1Result !== null) {
      results.set(item.key, tier1Result);
      report.tier1_esco_rules += 1;
      continue;
    }

    unresolved.push(item);
  }

  let remaining = unresolved;

  if (input.embedder !== null && remaining.length > 0) {
    const prototypes = await buildTier2Prototypes(input.embedder);

    const accepted = await classifyBatchWithEmbeddings(
      remaining,
      prototypes,
      input.embedder,
      input.thresholds ?? DEFAULT_EMBEDDING_THRESHOLDS,
    );

    for (const [key, classification] of accepted) {
      results.set(key, classification);
      updates[key] = {
        category: classification.category,
        role: classification.role,
        escoCode: classification.escoCode,
        secondaryRoles: [...classification.secondaryRoles],
        confidence: classification.confidence,
        source: "embeddings",
      };
      report.tier2_embeddings += 1;
    }

    remaining = remaining.filter((item) => !accepted.has(item.key));
  }

  if (input.haiku !== null && remaining.length > 0) {
    report.tier3_haiku_batch_sent = remaining.length;

    const haiku = await input.haiku(remaining);

    report.input_tokens = haiku.inputTokens;
    report.output_tokens = haiku.outputTokens;
    report.tier3_cost_usd = haiku.costMicros / 1_000_000;

    for (const [key, classification] of haiku.resolved) {
      const secondaryRoles = classification.secondaryRoles.map((role) => ({
        category: role.category,
        role: role.role,
        score: 1,
      }));

      results.set(key, {
        category: classification.category,
        role: classification.role,
        escoCode: classification.escoCode,
        secondaryRoles,
        confidence: 1,
        source: "haiku",
      });

      updates[key] = {
        category: classification.category,
        role: classification.role,
        escoCode: classification.escoCode,
        secondaryRoles,
        confidence: 1,
        source: "haiku",
      };
      report.tier3_haiku_resolved += 1;
    }

    remaining = remaining.filter((item) => !haiku.resolved.has(item.key));
  }

  report.still_untagged = remaining.length;

  return { results, updates, report };
}

/**
 * The cache key the ETL and the tests share.
 * @param title The raw title.
 * @param department The raw department.
 * @returns The key.
 */
export function classifierCacheKey(title: string, department: string | null) {
  return classificationCacheKey(title, department, ESCO_VERSION);
}
