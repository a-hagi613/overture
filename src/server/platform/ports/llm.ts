export interface LlmOutputSchemaProperty {
  type?: "string" | "number" | "boolean" | "object" | "array" | "null";
  description?: string;
  enum?: string[];
  items?: LlmOutputSchemaProperty;
  properties?: Record<string, LlmOutputSchemaProperty>;
  required?: string[];
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

export interface LlmPort {
  estimateBatchCostMicros: (requests: readonly LlmRequest[]) => number;
  runBatch: (requests: readonly LlmRequest[]) => Promise<LlmBatchCall[]>;
  estimateSingleCostMicros: (request: LlmSingleRequest) => number;
  runSingle: (request: LlmSingleRequest) => Promise<LlmSingleCall>;
}
