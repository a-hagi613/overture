import { z } from "zod";

import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export interface TextEmbedder {
  readonly id: string;
  readonly dimensions: number;
  readonly embed: (texts: readonly string[]) => Promise<readonly Float32Array[]>;
}

export const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small";
export const DEFAULT_EMBEDDING_FILE = "model_qint8_avx512_vnni";

const tensorRowsSchema = z.array(z.array(z.number()));

export interface OnnxEmbedderOptions {
  readonly model?: string;
  readonly modelFile?: string;
  readonly dimensions?: number;
  readonly batchSize?: number;
}

const embedChunks: (
  pipe: FeatureExtractionPipeline,
  batches: readonly (readonly string[])[],
  index: number,
  vectors: Float32Array[],
) => Promise<Float32Array[]> = async (pipe, batches, index, vectors) => {
  const batch = batches[index];

  if (batch === undefined) {
    return vectors;
  }

  const output = await pipe([...batch], { pooling: "mean", normalize: true });
  const rows = tensorRowsSchema.parse(output.tolist());

  for (const row of rows) {
    vectors.push(Float32Array.from(row));
  }

  return embedChunks(pipe, batches, index + 1, vectors);
};

export function createOnnxEmbedder(options: OnnxEmbedderOptions = {}) {
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

    const pipe = await transformers.pipeline<"feature-extraction">("feature-extraction", model, {
      dtype: "fp32",
      model_file_name: modelFile,
    });

    extractor = pipe;

    return pipe;
  }

  return {
    id: `onnx:${model}/${modelFile}`,
    dimensions,
    async embed(texts: readonly string[]) {
      const pipe = await load();
      const batches: string[][] = [];

      for (let offset = 0; offset < texts.length; offset += batchSize) {
        batches.push(texts.slice(offset, offset + batchSize));
      }

      return embedChunks(pipe, batches, 0, []);
    },
  } satisfies TextEmbedder;
}

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

  const vectors: Float32Array[] = [];

  const embedChunk: (offset: number) => Promise<Float32Array[]> = async (offset) => {
    const chunk = order.slice(offset, offset + batchSize);

    if (chunk.length === 0) {
      return vectors;
    }

    const embedded = await embedder.embed(chunk.map((entry) => texts[entry.index] ?? ""));

    for (const [position, vector] of embedded.entries()) {
      const target = chunk[position];

      if (target !== undefined) {
        vectors[target.index] = vector;
      }
    }

    return embedChunk(offset + batchSize);
  };

  return embedChunk(0);
}

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

export function createDeterministicEmbedder(dimensions = 64) {
  return {
    id: `deterministic:${String(dimensions)}`,
    dimensions,
    async embed(texts: readonly string[]) {
      const vectors = texts.map((text) => {
        const vector = new Float32Array(dimensions);

        for (const [index, character] of text.split("").entries()) {
          const slot = (character.codePointAt(0) ?? 0) % dimensions;

          vector[slot] = (vector[slot] ?? 0) + (index % 7) + 1;
        }

        return vector;
      });

      return await Promise.resolve(vectors);
    },
  } satisfies TextEmbedder;
}
