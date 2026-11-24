import { z } from "zod";

import { ROLE_GROUPS } from "../../shared/tag-taxonomy.ts";

import type { RoleGroup } from "../../shared/tag-taxonomy.ts";
import type { CatalogFetch } from "./stapply-refresh.ts";

import { DEFAULT_ANTHROPIC_MODEL, batchPricesFor } from "../platform/llm/models.ts";
import { ESCO_ROLES, escoOccupationByCode } from "./esco-taxonomy.ts";

/** The number of titles one prompt carries; the task's 30–40 window with a little headroom. */
export const HAIKU_BATCH_PROMPT_SIZE = 35;

export interface AmbiguousClassificationItem {
  readonly key: string;
  readonly title: string;
  readonly department: string | null;
  readonly jobCategory: string | null;
  readonly language: string | null;
}

export interface HaikuClassification {
  readonly category: RoleGroup;
  readonly role: string;
  readonly secondaryRoles: readonly { category: RoleGroup; role: string }[];
  readonly escoCode: string | null;
  readonly seniority: string | null;
}

export interface HaikuBatchResult {
  readonly resolved: ReadonlyMap<string, HaikuClassification>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
}

export type HaikuBatchClassifier = (
  items: readonly AmbiguousClassificationItem[],
) => Promise<HaikuBatchResult>;

const answerSchema = z.object({
  index: z.number().int().nonnegative(),
  primary_category: z.enum(ROLE_GROUPS),
  primary_role: z.string().min(1),
  secondary_roles: z.array(z.string()).default([]),
  esco_code: z.string().nullable().default(null),
  seniority: z.string().nullable().default(null),
});

const answerListSchema = z.union([
  z.array(answerSchema),
  z.object({ results: z.array(answerSchema) }),
]);

const batchCreateSchema = z.object({
  id: z.string().min(1),
  processing_status: z.string(),
  results_url: z.string().nullable().optional(),
});

const messageSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

const resultLineSchema = z.object({
  custom_id: z.string(),
  result: z.object({
    type: z.string(),
    message: messageSchema.optional(),
  }),
});

/**
 * The instructions Tier 3 receives. It may only answer with the Level-1 groups and Level-2 roles the pipeline knows,
 * and it is told to leave a value out rather than invent one.
 */
export const HAIKU_SYSTEM_PROMPT = [
  "You classify job titles for a job-search catalog.",
  `Level 1 categories: ${ROLE_GROUPS.join(", ")}.`,
  `Level 2 roles: ${ESCO_ROLES.join(", ")}.`,
  "For every title return primary_category, primary_role, up to two secondary_roles, an optional esco_code and a seniority.",
  "Use only values from the lists above; never invent a role or a category.",
  "Return only the JSON the tool requests.",
].join(" ");

function userPrompt(items: readonly AmbiguousClassificationItem[]) {
  return JSON.stringify({
    task: "classify these job titles",
    format: {
      results: [
        {
          index: 0,
          primary_category: "one category",
          primary_role: "one level 2 role",
          secondary_roles: ["at most two level 2 roles"],
          esco_code: "an ESCO occupation code or null",
          seniority: "intern|entry|mid|senior|staff|principal|manager|director or null",
        },
      ],
    },
    items: items.map((item, index) => ({
      index,
      title: item.title,
      department: item.department,
      job_category: item.jobCategory,
      language: item.language,
    })),
  });
}

function extractText(message: z.infer<typeof messageSchema>) {
  return message.content.flatMap((block) => block.text ?? []).join("");
}

function parseAnswers(text: string, items: readonly AmbiguousClassificationItem[]) {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?/u, "")
    .replace(/```$/u, "")
    .trim();

  let value: unknown;

  try {
    value = JSON.parse(jsonText);
  } catch {
    return new Map<string, HaikuClassification>();
  }

  const parsed = answerListSchema.safeParse(value);

  if (!parsed.success) {
    return new Map<string, HaikuClassification>();
  }

  const answers = Array.isArray(parsed.data) ? parsed.data : parsed.data.results;
  const resolved = new Map<string, HaikuClassification>();
  const roles = new Set(ESCO_ROLES);

  for (const answer of answers) {
    const item = items[answer.index];

    if (item === undefined || resolved.has(item.key) || !roles.has(answer.primary_role)) {
      continue;
    }

    resolved.set(item.key, {
      category: answer.primary_category,
      role: answer.primary_role,
      secondaryRoles: answer.secondary_roles
        .filter((role) => roles.has(role) && role !== answer.primary_role)
        .slice(0, 2)
        .map((role) => ({ category: answer.primary_category, role })),
      escoCode:
        answer.esco_code !== null && escoOccupationByCode(answer.esco_code) !== null
          ? answer.esco_code
          : null,
      seniority: answer.seniority,
    });
  }

  return resolved;
}

export interface HaikuClassifierConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: CatalogFetch;
  readonly promptSize?: number;
  readonly maxTokens?: number;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

/**
 * The Tier-3 classifier over the Anthropic Message Batches API. It submits one batch whose requests carry 30–40
 * titles each, waits for the batch to end, and folds the JSONL results back onto the input keys. A failed submission
 * or a batch that never ends yields an empty result, so the daily run degrades to Tier 2 rather than failing.
 * @param config The key, model, fetch and polling settings.
 * @returns The batch classifier.
 */
export function createHaikuBatchClassifier(config: HaikuClassifierConfig): HaikuBatchClassifier {
  const model = config.model ?? DEFAULT_ANTHROPIC_MODEL;
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/u, "");
  const call: CatalogFetch = config.fetchImpl ?? fetch;
  const promptSize = config.promptSize ?? HAIKU_BATCH_PROMPT_SIZE;
  const pollIntervalMs = config.pollIntervalMs ?? 5_000;
  const maxPolls = config.maxPolls ?? 120;
  const prices = batchPricesFor(model);

  const headers = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "x-api-key": config.apiKey,
  };

  async function submit(items: readonly AmbiguousClassificationItem[]) {
    const requests = [];

    for (let offset = 0; offset < items.length; offset += promptSize) {
      const chunk = items.slice(offset, offset + promptSize);

      requests.push({
        custom_id: `classify-${String(offset / promptSize)}`,
        params: {
          model,
          max_tokens: config.maxTokens ?? 4096,
          system: HAIKU_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt(chunk) }],
        },
      });
    }

    const response = await call(`${baseUrl}/v1/messages/batches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic batch submit failed: HTTP ${String(response.status)}`);
    }

    return batchCreateSchema.parse(await response.json());
  }

  async function waitForBatch(id: string) {
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const response = await call(`${baseUrl}/v1/messages/batches/${id}`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(`Anthropic batch poll failed: HTTP ${String(response.status)}`);
      }

      const batch = batchCreateSchema.parse(await response.json());

      if (batch.processing_status === "ended") {
        return batch;
      }

      await Bun.sleep(pollIntervalMs);
    }

    throw new Error(`Anthropic batch ${id} did not end within ${String(maxPolls)} polls`);
  }

  async function downloadResults(batch: z.infer<typeof batchCreateSchema>) {
    const url = batch.results_url ?? `${baseUrl}/v1/messages/batches/${batch.id}/results`;
    const response = await call(url, { method: "GET", headers });

    if (!response.ok) {
      throw new Error(`Anthropic batch results failed: HTTP ${String(response.status)}`);
    }

    return new TextDecoder().decode(await response.arrayBuffer());
  }

  const classify: HaikuBatchClassifier = async (items) => {
    if (items.length === 0) {
      return { resolved: new Map(), inputTokens: 0, outputTokens: 0, costMicros: 0 };
    }

    try {
      const batch = await submit(items);
      const ended = await waitForBatch(batch.id);
      const lines = (await downloadResults(ended)).split("\n").filter((line) => line.trim() !== "");

      const resolved = new Map<string, HaikuClassification>();
      let inputTokens = 0;
      let outputTokens = 0;

      for (const line of lines) {
        const parsed = resultLineSchema.safeParse(JSON.parse(line));

        if (!parsed.success || parsed.data.result.type !== "succeeded") {
          continue;
        }

        const message = parsed.data.result.message;

        if (message === undefined) {
          continue;
        }

        inputTokens += message.usage?.input_tokens ?? 0;
        outputTokens += message.usage?.output_tokens ?? 0;

        const requestIndex = Number(parsed.data.custom_id.replace("classify-", ""));
        const chunk = items.slice(
          requestIndex * promptSize,
          requestIndex * promptSize + promptSize,
        );

        for (const [key, value] of parseAnswers(extractText(message), chunk)) {
          resolved.set(key, value);
        }
      }

      const costMicros =
        (inputTokens * prices.inputPerMillionTokens) / 1_000_000 +
        (outputTokens * prices.outputPerMillionTokens) / 1_000_000;

      return { resolved, inputTokens, outputTokens, costMicros };
    } catch {
      return { resolved: new Map(), inputTokens: 0, outputTokens: 0, costMicros: 0 };
    }
  };

  return classify;
}

/** The parsed answer shape, exported for the tests that assert the strict-JSON contract. */
export { answerListSchema };
