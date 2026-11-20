import { readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { join } from "node:path";

import { z } from "zod";

const documentContentSchema = z.object({
  type: z.literal("document"),
  source: z.object({
    type: z.literal("base64"),
    media_type: z.literal("application/pdf"),
    data: z.string().min(1),
  }),
});

const singleMessageRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z
    .array(
      z.object({
        role: z.literal("user"),
        content: z
          .array(
            z.union([
              documentContentSchema,
              z.object({ type: z.literal("text"), text: z.string() }),
            ]),
          )
          .min(1),
      }),
    )
    .min(1),
});

const recordedMessageSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  content: z.array(z.object({ type: z.string(), text: z.string().nullish() })),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

const recordingSchema = z.object({
  title: z.string().min(1),
  messageId: z.string().min(1),
  messageText: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

const batchCreateRequestSchema = z.object({
  custom_id: z.string().min(1),
  params: z.object({
    model: z.string().min(1),
    max_tokens: z.number().int().positive(),
    system: z.array(
      z.object({
        type: z.string(),
        text: z.string(),
        cache_control: z.object({ type: z.string() }).nullish(),
      }),
    ),
    messages: z.array(z.object({ role: z.string(), content: z.string() })),
    output_config: z.object({
      format: z.object({ type: z.string(), schema: z.record(z.string(), z.unknown()) }),
    }),
  }),
});

const titleFromPrompt = /(?:^|\n)title: (?<title>.+)$/mu;
const questionFromPrompt = /(?:^|\n)question: (?<question>.+)$/mu;

const CREATED_AT = "2026-11-20T12:00:00.000Z";
const ENDED_AT = "2026-11-20T12:01:00.000Z";
const EXPIRES_AT = "2026-11-21T12:00:00.000Z";

export interface RecordedBatchRequest {
  customId: string;
  title: string;
  model: string;
  cacheControl: string | null;
  outputFormatType: string;
  user: string;
}

export interface RecordedSingleMessage {
  model: string;
  hasDocument: boolean;
  pdfBytes: number;
  userText: string;
}

export interface AnthropicFixtureServer {
  url: string;
  stop: () => void;
  batchesCreated: () => number;
  requests: () => RecordedBatchRequest[];
  singleMessages: () => RecordedSingleMessage[];
}

interface BatchItem {
  customId: string;
  recording: z.infer<typeof recordingSchema>;
}

interface TrackedBatch {
  id: string;
  items: BatchItem[];
}

type Recording = z.infer<typeof recordingSchema>;

export function loadResumePdfFallbackRecordingSync() {
  const path = join(process.cwd(), "test/e2e/recordings/anthropic/resume-pdf-fallback.json");

  return recordedMessageSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadTagFallbackRecordingsSync() {
  const path = join(process.cwd(), "test/e2e/fixtures/anthropic/tag-fallback-recording.jsonl");
  const byTitle = new Map<string, Recording>();

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const parsed = recordingSchema.parse(JSON.parse(line));

    byTitle.set(parsed.title, parsed);
  }

  return byTitle;
}

export function loadQuestionMappingRecordingsSync() {
  const path = join(process.cwd(), "test/e2e/fixtures/anthropic/question-mapping-recording.jsonl");
  const byQuestion = new Map<string, Recording>();

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const parsed = recordingSchema.parse(JSON.parse(line));

    byQuestion.set(parsed.title, parsed);
  }

  return byQuestion;
}

export function loadScoreRecordingsSync() {
  const path = join(process.cwd(), "test/e2e/fixtures/anthropic/score-recording.jsonl");
  const byTitle = new Map<string, Recording>();

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const parsed = recordingSchema.parse(JSON.parse(line));

    byTitle.set(parsed.title, parsed);
  }

  return byTitle;
}

function finishJson(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
}

async function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", () => {
      reject(new Error("the request body could not be read"));
    });
  });
}

function serveResults(batch: TrackedBatch) {
  return batch.items
    .map((item) =>
      JSON.stringify({
        custom_id: item.customId,
        result: {
          type: "succeeded",
          message: {
            id: item.recording.messageId,
            type: "message",
            role: "assistant",
            model: "claude-haiku-4-5",
            content: [{ type: "text", text: item.recording.messageText }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: {
              input_tokens: item.recording.inputTokens,
              cache_creation_input_tokens: item.recording.cacheWriteTokens,
              cache_read_input_tokens: item.recording.cacheReadTokens,
              output_tokens: item.recording.outputTokens,
            },
          },
        },
      }),
    )
    .join("\n");
}

export async function startAnthropicFixtureServer() {
  const recordings = loadTagFallbackRecordingsSync();
  const scoreRecordings = loadScoreRecordingsSync();
  const questionRecordings = loadQuestionMappingRecordingsSync();
  const resumeFallback = loadResumePdfFallbackRecordingSync();
  const batches = new Map<string, TrackedBatch>();
  const seenRequests: RecordedBatchRequest[] = [];
  const seenSingleMessages: RecordedSingleMessage[] = [];

  let createdBatches = 0;
  let batchCounter = 0;

  const server: Server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  function baseUrl() {
    const address = server.address();

    return `http://127.0.0.1:${String(portFrom(address))}`;
  }

  async function createSingleMessage(request: IncomingMessage, response: ServerResponse) {
    const parsed = singleMessageRequestSchema.parse(JSON.parse(await readBody(request)));
    const message = parsed.messages.at(0);

    if (message === undefined) {
      throw new Error("the single message request carried no message");
    }

    const { document, text } = seenBlocksFor(message);

    seenSingleMessages.push({
      model: parsed.model,
      hasDocument: true,
      pdfBytes: Buffer.from(document.source.data, "base64").byteLength,
      userText: text.text,
    });

    finishJson(
      response,
      200,
      JSON.stringify({
        id: resumeFallback.id,
        type: "message",
        role: "assistant",
        model: resumeFallback.model,
        content: resumeFallback.content,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: resumeFallback.usage.input_tokens,
          cache_creation_input_tokens: resumeFallback.usage.cache_creation_input_tokens,
          cache_read_input_tokens: resumeFallback.usage.cache_read_input_tokens,
          output_tokens: resumeFallback.usage.output_tokens,
        },
      }),
    );
  }

  async function createBatch(request: IncomingMessage, response: ServerResponse) {
    const createBody = z
      .object({ requests: z.array(batchCreateRequestSchema).min(1) })
      .parse(JSON.parse(await readBody(request)));

    batchCounter += 1;
    createdBatches += 1;

    const batchId = `msgbatch_01RecordedBatch${String(batchCounter).padStart(4, "0")}`;
    const items: BatchItem[] = [];

    for (const batchRequest of createBody.requests) {
      const userContent = batchRequest.params.messages.at(0)?.content ?? "";
      const title = titleFromPrompt.exec(userContent)?.groups?.title ?? null;
      const question = questionFromPrompt.exec(userContent)?.groups?.question ?? null;

      if (title === null && question === null) {
        finishJson(
          response,
          500,
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "the request carries no title" },
          }),
        );

        return;
      }

      const recording =
        (question === null ? undefined : questionRecordings.get(question)) ??
        (title === null ? undefined : (recordings.get(title) ?? scoreRecordings.get(title)));

      if (recording === undefined) {
        finishJson(
          response,
          500,
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: `no recording for ${question ?? title ?? "the request"}`,
            },
          }),
        );

        return;
      }

      seenRequests.push({
        customId: batchRequest.custom_id,
        title: question ?? title ?? "",
        model: batchRequest.params.model,
        cacheControl: batchRequest.params.system.at(0)?.cache_control?.type ?? null,
        outputFormatType: batchRequest.params.output_config.format.type,
        user: userContent,
      });

      items.push({ customId: batchRequest.custom_id, recording });
    }

    batches.set(batchId, { id: batchId, items });

    finishJson(
      response,
      200,
      JSON.stringify({
        type: "message_batch",
        id: batchId,
        archived_at: null,
        processing_status: "in_progress",
        request_counts: {
          processing: items.length,
          succeeded: 0,
          errored: 0,
          canceled: 0,
          expired: 0,
        },
        ends_at: null,
        ended_at: null,
        expires_at: EXPIRES_AT,
        results_url: null,
        created_at: CREATED_AT,
      }),
    );
  }

  function retrieveBatch(response: ServerResponse, batchId: string) {
    const batch = batches.get(batchId);

    if (batch === undefined) {
      finishJson(
        response,
        404,
        JSON.stringify({ type: "error", error: { type: "not_found_error", message: "batch" } }),
      );

      return;
    }

    finishJson(
      response,
      200,
      JSON.stringify({
        type: "message_batch",
        id: batch.id,
        archived_at: null,
        processing_status: "ended",
        request_counts: {
          processing: 0,
          succeeded: batch.items.length,
          errored: 0,
          canceled: 0,
          expired: 0,
        },
        ends_at: null,
        ended_at: ENDED_AT,
        expires_at: EXPIRES_AT,
        results_url: `${baseUrl()}/v1/messages/batches/${batch.id}/results`,
        created_at: CREATED_AT,
      }),
    );
  }

  function resultsFor(response: ServerResponse, batchId: string) {
    const batch = batches.get(batchId);

    if (batch === undefined) {
      finishJson(
        response,
        404,
        JSON.stringify({ type: "error", error: { type: "not_found_error", message: "batch" } }),
      );

      return;
    }

    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.end(serveResults(batch));
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "POST" && pathname === "/v1/messages") {
      await createSingleMessage(request, response);

      return;
    }

    const path = batchPathMatch(pathname);

    if (request.method === "POST" && path?.batchId === null) {
      await createBatch(request, response);

      return;
    }

    if (request.method === "GET" && path !== null && path.batchId !== null) {
      if (path.suffix === "results") {
        resultsFor(response, path.batchId);

        return;
      }

      retrieveBatch(response, path.batchId);

      return;
    }

    finishJson(
      response,
      404,
      JSON.stringify({ type: "error", error: { type: "not_found_error", message: pathname } }),
    );
  }

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    url: baseUrl(),
    stop: () => {
      server.close();
    },
    batchesCreated: () => createdBatches,
    requests: () => [...seenRequests],
    singleMessages: () => [...seenSingleMessages],
  } satisfies AnthropicFixtureServer;
}

function batchPathMatch(pathname: string) {
  const match =
    /^\/v1\/messages\/batches(?:\/(?<batchId>[A-Za-z0-9_-]+)(?<suffix>\/results)?)?$/u.exec(
      pathname,
    );

  const batchId = match?.groups?.batchId ?? null;

  if (match === null) {
    return null;
  }

  return {
    batchId,
    suffix: match.groups?.suffix === "/results" ? ("results" as const) : null,
  };
}

function portFrom(address: string | { port: number } | null) {
  const parsed = z.object({ port: z.number() }).safeParse(address);

  if (!parsed.success) {
    throw new Error("the fixture server did not bind to a port");
  }

  return parsed.data.port;
}

function seenBlocksFor(message: z.infer<typeof singleMessageRequestSchema>["messages"][number]) {
  const document = message.content.find((block) => block.type === "document");
  const text = message.content.find((block) => block.type === "text");

  if (document === undefined || text === undefined) {
    throw new Error("the single message request carried no document or text block");
  }

  return { document, text };
}
