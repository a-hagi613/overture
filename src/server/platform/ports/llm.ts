/** One property of a structured output schema, as the provider's JSON Schema accepts it. */
export interface LlmOutputSchemaProperty {
  type?: "string" | "number" | "boolean" | "object" | "array" | "null";
  description?: string;
  enum?: string[];
  items?: LlmOutputSchemaProperty;
  properties?: Record<string, LlmOutputSchemaProperty>;
  required?: string[];
}

/** The structured output schema a call must return JSON for. */
export interface LlmOutputSchema {
  type: "object";
  properties: Record<string, LlmOutputSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

/** JSON Schema the model's answer must satisfy, as passed to the provider's structured output feature. */
export interface LlmRequest {
  /** Key recorded on the usage row for this call, e.g. "tag_fallback". */
  purpose: string;
  /** Stable identifier that joins a request to its line in the batch results. */
  customId: string;
  /** Fixed instruction prompt, identical across calls so prompt caching can reuse it. */
  system: string;
  /** Variable per-request content. */
  user: string;
  /** Structured output schema for the JSON the model must return. */
  schema: LlmOutputSchema;
}

export interface LlmBatchCall {
  customId: string;
  result: { ok: true; value: unknown } | { ok: false; error: string };
  model: string;
  inputTokens: number;
  /** Tokens read from the prompt cache, e.g. cache_read_input_tokens. */
  cachedTokens: number;
  /** Tokens written to the prompt cache, e.g. cache_creation_input_tokens. */
  cacheWriteTokens: number;
  outputTokens: number;
  /** Cost of the call in micro-USD. */
  costMicros: number;
}

/**
 * Calls a large language model for the automated work a user never sees the prompts of.
 * The production adapter speaks the Anthropic Message Batches API behind this port, with
 * structured JSON output and prompt caching on the fixed system prompt; the adapter's base
 * URL and model come from config, so tests point the port at a local server that replays
 * recorded responses and never contact the real provider.
 */
export interface LlmPort {
  /** What sending these requests would cost in micro-USD, charged before anything is sent, so spending caps can fail closed. */
  estimateBatchCostMicros: (requests: readonly LlmRequest[]) => number;
  /** Sends the requests as one batch; every answered request carries its token usage and its cost. */
  runBatch: (requests: readonly LlmRequest[]) => Promise<LlmBatchCall[]>;
}
