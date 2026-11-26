export type LlmOutputSchemaType = "string" | "number" | "boolean" | "object" | "array" | "null";

export interface LlmOutputSchemaProperty {
  type?: LlmOutputSchemaType | readonly LlmOutputSchemaType[];
  description?: string;
  enum?: string[];
  items?: LlmOutputSchemaProperty;
  properties?: Record<string, LlmOutputSchemaProperty>;
  required?: string[];
  additionalProperties?: false;
}

export interface LlmOutputSchema {
  type: "object";
  properties: Record<string, LlmOutputSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

export interface LlmRequest {
  purpose: string;
  customId: string;
  system: string;
  user: string;
  schema: LlmOutputSchema;
}

export interface LlmBatchCall {
  /** The recorded durable batch that produced this call, which makes its usage row idempotent. */
  batchRecordId?: string | undefined;
  customId: string;
  result: { ok: true; value: unknown } | { ok: false; error: string };
  model: string;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface LlmSingleRequest {
  user: string;
  pdf: Uint8Array<ArrayBuffer>;
}

export interface LlmSingleCall {
  model: string;
  text: string | null;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface LlmStructuredRequest {
  /** The `llm_usage` purpose the call is billed to. */
  purpose: string;
  system: string;
  user: string;
  schema: LlmOutputSchema;
}

export interface LlmStructuredCall {
  model: string;
  /** The reply's text block, or null when the reply carried none. */
  text: string | null;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface LlmPort {
  estimateBatchCostMicros: (requests: readonly LlmRequest[]) => number;
  runBatch: (requests: readonly LlmRequest[]) => Promise<LlmBatchCall[]>;
  estimateSingleCostMicros: (request: LlmSingleRequest) => number;
  runSingle: (request: LlmSingleRequest) => Promise<LlmSingleCall>;
  estimateStructuredCostMicros: (request: LlmStructuredRequest) => number;
  runStructured: (request: LlmStructuredRequest) => Promise<LlmStructuredCall>;
}
