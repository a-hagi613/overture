import { z } from "zod";

import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * The embedding port the classifier depends on. Tests inject a fake, so unit shards never download a model; the daily
 * run builds the ONNX implementation below.
 */
export interface TextEmbedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<readonly Float32Array[]>;
}

/**
 * The official intfloat repository publishes its int8 ONNX under a name the library's `dtype` shortcuts do not know,
 * so the file name is passed explicitly. The file is ~120 MB and is fetched once per runner.
 */
export const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small";
export const DEFAULT_EMBEDDING_FILE = "model_qint8_avx512_vnni";

const tensorRowsSchema = z.array(z.array(z.number()));

export interface OnnxEmbedderOptions {
  readonly model?: string;
  readonly modelFile?: string;
  readonly dimensions?: number;
  readonly batchSize?: number;
}

/**
 * The quantized ONNX embedder, lazily imported so the ETL pays for `onnxruntime-node` only when Tier 2 runs and unit
 * tests never touch it. It embeds with mean pooling and L2 normalization, the pooling the e5 family expects.
 * @param options The model id, file, dimensions and batch size.
 * @returns The embedder.
 */
export function createOnnxEmbedder(options: OnnxEmbedderOptions = {}): TextEmbedder {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const modelFile = options.modelFile ?? DEFAULT_EMBEDDING_FILE;
  const dimensions = options.dimensions ?? 384;
  const batchSize = options.batchSize ?? 32;
  let extractor: FeatureExtractionPipeline | null = null;

  async function load() {
    if (extractor !== null) {
      return extractor;
    }

    const transformers = await import("@huggingface/transformers");

    transformers.env.allowLocalModels = false;

    extractor = await transformers.pipeline("feature-extraction", model, {
      dtype: "fp32",
      model_file_name: modelFile,
    });

    return extractor;
  }

  return {
    id: `onnx:${model}/${modelFile}`,
    dimensions,
    async embed(texts) {
      const pipe = await load();
      const vectors: Float32Array[] = [];

      for (let offset = 0; offset < texts.length; offset += batchSize) {
        const batch = texts.slice(offset, offset + batchSize);
        const output = await pipe([...batch], { pooling: "mean", normalize: true });
        const rows = tensorRowsSchema.parse(output.tolist());

        for (const row of rows) {
          vectors.push(Float32Array.from(row));
        }
      }

      return vectors;
    },
  };
}

/**
 * Embeds in length-sorted batches, reassembling the results in the caller's order. Sorting by length keeps the ONNX
 * batch's sequence length near its mean, which is the difference between a few minutes and an hour over a full
 * snapshot.
 * @param embedder The embedding port.
 * @param texts The texts to embed.
 * @param batchSize The batch size.
 * @returns One vector per input text, in input order.
 */
export async function embedInBatches(
  embedder: TextEmbedder,
  texts: readonly string[],
  batchSize = 32,
) {
  if (texts.length === 0) {
    return [];
  }

  const order = texts
    .map((text, index) => ({ index, length: text.length }))
    .toSorted((left, right) => left.length - right.length);

  const vectors = new Array<Float32Array>(texts.length);

  for (let offset = 0; offset < order.length; offset += batchSize) {
    const chunk = order.slice(offset, offset + batchSize);
    const embedded = await embedder.embed(chunk.map((entry) => texts[entry.index] ?? ""));

    for (const [position, vector] of embedded.entries()) {
      const target = chunk[position];

      if (target !== undefined) {
        vectors[target.index] = vector;
      }
    }
  }

  return vectors;
}

/**
 * @param left A vector.
 * @param right Another vector.
 * @returns The cosine similarity, or zero for a zero-length or mismatched pair.
 */
export function cosineSimilarity(left: Float32Array, right: Float32Array) {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;

    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * A deterministic hashing embedder for dry runs and tests that need *an* embedding without a model download. It is
 * not a semantic model; it only keeps the pipeline's plumbing exercisable.
 * @param dimensions The vector width.
 * @returns The embedder.
 */
export function createDeterministicEmbedder(dimensions = 64): TextEmbedder {
  return {
    id: `deterministic:${String(dimensions)}`,
    dimensions,
    embed(texts) {
      return Promise.resolve(
        texts.map((text) => {
          const vector = new Float32Array(dimensions);

          for (const [index, character] of [...text].entries()) {
            const slot = (character.codePointAt(0) ?? 0) % dimensions;

            vector[slot] = (vector[slot] ?? 0) + (index % 7) + 1;
          }

          return vector;
        }),
      );
    },
  };
}
