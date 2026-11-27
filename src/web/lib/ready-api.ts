import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const ANSWER_SOURCES = ["fact", "consent", "file", "open_text", "target", "derived"] as const;

const answerSchema = z.object({
  answer: z.string().nullable(),
  block: z.string().nullable(),
  byUser: z.boolean(),
  coverLetter: z.boolean(),
  factKey: z.string().nullable(),
  factRevision: z.number().nullable(),
  factSource: z.enum(["resume", "user", "review", "import"]).nullable(),
  kind: z.string(),
  label: z.string(),
  questionId: z.string(),
  required: z.boolean(),
  sentences: z.array(z.string()),
  source: z.enum(ANSWER_SOURCES).nullable(),
});

export type ReadyAnswer = z.infer<typeof answerSchema>;

const planSchema = z.object({
  answers: z.array(answerSchema),
  consentVersion: z.string(),
  coverLetter: z.array(z.string()).nullable(),
  hasGeneratedProse: z.boolean(),
  planSha256: z.string(),
  postingTitle: z.string(),
  postingUrl: z.string(),
  resume: z.object({ filename: z.string(), uploadedAt: z.number() }).nullable(),
});

export type ReadyPlan = z.infer<typeof planSchema>;

const cardSchema = z.object({
  approvedAt: z.number().nullable(),
  changes: z.array(z.string()),
  company: z.string(),
  id: z.string(),
  location: z.string().nullable(),
  logoUrl: z.string().nullable().optional(),
  plan: planSchema.nullable(),
  queuePosition: z.number().nullable(),
  readyAt: z.number().nullable(),
  score: z.number().nullable(),
  sendAt: z.number().nullable(),
  status: z.enum(["ready", "approved"]),
  strong: z.boolean(),
  title: z.string().nullable(),
});

export type ReadyCard = z.infer<typeof cardSchema>;

const readySchema = z.object({
  approved: z.number(),
  cards: z.array(cardSchema),
  nextSendAt: z.number().nullable(),
  ready: z.number(),
});

export type ReadyResponse = z.infer<typeof readySchema>;

export class ReadyApiError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ReadyApiError";
  }
}

interface ApprovePayload {
  dwellMs?: number | undefined;
  planSha256: string;
}

interface ApproveAllPayload {
  dwellMs?: number | undefined;
  items: { id: string; planSha256: string }[];
}

async function jsonFrom(response: Response) {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = z.object({ error: z.string() }).safeParse(body);

    throw new ReadyApiError(parsed.success ? parsed.data.error : "request_failed");
  }

  return z.unknown().parse(await response.json());
}

export async function fetchReady() {
  return readySchema.parse(await jsonFrom(await fetch("/api/ready")));
}

async function approveOne(input: { dwellMs?: number | undefined; id: string; planSha256: string }) {
  const payload: ApprovePayload = {
    planSha256: input.planSha256,
  };

  if (input.dwellMs !== undefined) {
    payload.dwellMs = input.dwellMs;
  }

  return jsonFrom(
    await fetch(`/api/applications/${encodeURIComponent(input.id)}/approve`, {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

async function approveAll(input: {
  dwellMs?: number | undefined;
  items: { id: string; planSha256: string }[];
}) {
  const payload: ApproveAllPayload = { items: input.items };

  if (input.dwellMs !== undefined) {
    payload.dwellMs = input.dwellMs;
  }

  const body = z
    .object({
      approved: z.array(
        z.object({ approvedAt: z.number(), id: z.string(), planSha256: z.string() }),
      ),
      refused: z.array(z.object({ error: z.string(), id: z.string() })),
    })
    .parse(
      await jsonFrom(
        await fetch("/api/ready/approve", {
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    );

  return body;
}

async function unapprove(id: string) {
  return jsonFrom(
    await fetch(`/api/applications/${encodeURIComponent(id)}/unapprove`, { method: "POST" }),
  );
}

async function skip(id: string) {
  return jsonFrom(
    await fetch(`/api/applications/${encodeURIComponent(id)}/withdraw`, { method: "POST" }),
  );
}

async function editAnswer(input: { applicationId: string; questionId: string; value: string }) {
  return jsonFrom(
    await fetch(
      `/api/applications/${encodeURIComponent(input.applicationId)}/answers/${encodeURIComponent(input.questionId)}`,
      {
        body: JSON.stringify({ value: input.value }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    ),
  );
}

function useInvalidateReady() {
  const client = useQueryClient();

  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["ready"] }),
      client.invalidateQueries({ queryKey: ["home"] }),
      client.invalidateQueries({ queryKey: ["nav"] }),
      client.invalidateQueries({ queryKey: ["board"] }),
      client.invalidateQueries({ queryKey: ["application"] }),
      client.invalidateQueries({ queryKey: ["profile-facts"] }),
    ]);
  };
}

export function useReady() {
  return useQuery({ queryFn: fetchReady, queryKey: ["ready"], retry: 1 });
}

export function useApprove() {
  const invalidate = useInvalidateReady();

  return useMutation({
    mutationFn: approveOne,
    onSuccess: invalidate,
  });
}

export function useApproveAll() {
  const invalidate = useInvalidateReady();

  return useMutation({
    mutationFn: approveAll,
    onSuccess: invalidate,
  });
}

export function useUnapprove() {
  const invalidate = useInvalidateReady();

  return useMutation({
    mutationFn: unapprove,
    onSuccess: invalidate,
  });
}

export function useSkipReady() {
  const invalidate = useInvalidateReady();

  return useMutation({
    mutationFn: skip,
    onSuccess: invalidate,
  });
}

export function useEditAnswer() {
  const invalidate = useInvalidateReady();

  return useMutation({
    mutationFn: editAnswer,
    onSuccess: invalidate,
  });
}
