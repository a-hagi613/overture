import { z } from "zod";

import { ROLE_GROUPS, SUBROLES } from "../../shared/tag-taxonomy.ts";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { StapplyLeftover } from "./stapply-delta.ts";
import type { CatalogFetch } from "./stapply-refresh.ts";

import { DEFAULT_ANTHROPIC_MODEL } from "../platform/llm/models.ts";
import { selectStapplyLeftovers } from "./stapply-delta.ts";
import { writePostingTags } from "./tag-store.ts";

/**
 * How many leftovers one request carries. Batched deliberately: a request per posting would cost the runner minutes
 * and a call per row is not what Haiku is priced for.
 */
export const STAPPLY_LLM_BATCH_SIZE = 25;

/**
 * The default ceiling of leftover postings one run sends.
 */
export const STAPPLY_LLM_MAX_ROWS = 500;

/**
 * The instructions the classifier receives. It may only answer with the taxonomy's role groups and subroles.
 */
export const STAPPLY_LLM_SYSTEM_PROMPT = [
  "You classify job postings for a job-search tool that filters by role.",
  `Role groups: ${ROLE_GROUPS.join(", ")}.`,
  `Subroles, only for the Software Engineering role group: ${SUBROLES.join(", ")}.`,
  "Never invent values outside those lists.",
  "Use the company, title, department, team, location, workplace and employment type that follow.",
  "Return only the JSON the tool requests.",
].join(" ");

const answerSchema = z.object({
  index: z.number().int().nonnegative(),
  role: z.enum(ROLE_GROUPS).nullable(),
  subrole: z.enum(SUBROLES).nullable(),
});

const answerListSchema = z.union([
  z.array(answerSchema),
  z.object({ results: z.array(answerSchema) }),
]);

const anthropicResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
});

export interface StapplyClassification {
  readonly id: string;
  readonly role: string | null;
  readonly subrole: string | null;
}

export type StapplyClassifier = (
  items: readonly StapplyLeftover[],
) => Promise<readonly StapplyClassification[]>;

/**
 * Parses a model answer into one classification per posting index. Unknown indices and values outside the taxonomy are
 * dropped rather than trusted.
 * @param text The model's raw text.
 * @param count How many postings the request carried.
 * @returns The accepted answers by posting index.
 */
export function parseStapplyLlmAnswer(text: string, count: number) {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?/u, "")
    .replace(/```$/u, "")
    .trim();

  const accepted = new Map<number, { role: string | null; subrole: string | null }>();

  let value: unknown;

  try {
    value = JSON.parse(jsonText);
  } catch {
    return accepted;
  }

  const parsed = answerListSchema.safeParse(value);

  if (!parsed.success) {
    return accepted;
  }

  const answers = Array.isArray(parsed.data) ? parsed.data : parsed.data.results;

  for (const answer of answers) {
    if (answer.index < count && !accepted.has(answer.index)) {
      accepted.set(answer.index, { role: answer.role, subrole: answer.subrole });
    }
  }

  return accepted;
}

function requestPrompt(items: readonly StapplyLeftover[]) {
  return JSON.stringify({
    task: "classify these postings",
    format: {
      results: [{ index: 0, role: "one of the role groups or null", subrole: "a subrole or null" }],
    },
    postings: items.map((item, index) => ({
      index,
      company: item.companyName,
      title: item.title,
      department: item.department,
      team: item.team,
      location: item.locationRaw,
      workplace: item.workplace,
      employmentType: item.employmentType,
      experience: item.experience,
    })),
  });
}

export interface AnthropicClassifierConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: CatalogFetch;
  readonly maxTokens?: number;
}

/**
 * The classifier the workflow uses: one Haiku request per batch, structured JSON, no tools. A missing key is the
 * caller's decision, not this factory's, so dry runs never build it.
 * @param config The key, model and optional fetch for tests.
 * @returns A classifier that asks Haiku 5.5.
 */
export function createAnthropicStapplyClassifier(config: AnthropicClassifierConfig) {
  const model = config.model ?? DEFAULT_ANTHROPIC_MODEL;
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/u, "");
  const call: CatalogFetch = config.fetchImpl ?? fetch;

  const classify: StapplyClassifier = async (items) => {
    const response = await call(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: config.maxTokens ?? 2000,
        temperature: 0,
        system: STAPPLY_LLM_SYSTEM_PROMPT,
        messages: [{ role: "user", content: requestPrompt(items) }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Stapply LLM tagging failed: HTTP ${String(response.status)}`);
    }

    const body = anthropicResponseSchema.parse(await response.json());

    const text = body.content
      .flatMap((block) => (block.text === undefined ? [] : [block.text]))
      .join("");

    const accepted = parseStapplyLlmAnswer(text, items.length);
    const classifications: StapplyClassification[] = [];

    for (const [index, answer] of accepted) {
      const item = items[index];

      if (item !== undefined) {
        classifications.push({ id: item.id, role: answer.role, subrole: answer.subrole });
      }
    }

    return classifications;
  };

  return classify;
}

export interface StapplyLlmTaggingInput {
  readonly db: CatalogDatabase;
  readonly classifier: StapplyClassifier | null;
  readonly now: number;
  readonly limit: number;
  readonly batchSize: number;
}

/**
 * Tags the newly inserted postings whose role the rules left unresolved, in batches, and stores the answers at `llm`
 * precedence so a stronger existing tag always wins. A null classifier or a failed batch stops the pass without
 * failing the run.
 * @param input The catalog, the classifier and the row ceiling.
 * @returns What was considered, sent and written.
 */
export async function runStapplyLlmTagging(input: StapplyLlmTaggingInput) {
  const leftovers = selectStapplyLeftovers(input.db, input.limit);
  const report = { considered: leftovers.length, sent: 0, tagged: 0, skipped: 0, available: true };

  if (leftovers.length === 0) {
    return report;
  }

  if (input.classifier === null) {
    return { ...report, skipped: leftovers.length, available: false };
  }

  const sendBatch = async (offset: number) => {
    if (offset >= leftovers.length) {
      return;
    }

    const batch = leftovers.slice(offset, offset + input.batchSize);

    let classifications: readonly StapplyClassification[];

    try {
      classifications = (await input.classifier?.(batch)) ?? [];
    } catch {
      report.skipped += leftovers.length - offset;

      return;
    }

    report.sent += batch.length;

    if (classifications.length === 0) {
      report.skipped += batch.length;
    } else {
      input.db.transaction(
        (tx) => {
          for (const classification of classifications) {
            const writes = [
              ["role", classification.role],
              ["subrole", classification.subrole],
            ] as const;

            writePostingTags(
              tx,
              classification.id,
              writes.flatMap(([dimension, value]) =>
                value === null ? [] : [{ dimension, value, source: "llm" as const }],
              ),
              input.now,
            );
            report.tagged += 1;
          }
        },
        { behavior: "immediate" },
      );
    }

    await sendBatch(offset + input.batchSize);
  };

  await sendBatch(0);

  return report;
}
