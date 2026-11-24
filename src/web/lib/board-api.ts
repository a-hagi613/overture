import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { BOARD_STAGES } from "../../shared/board.ts";
import { dossierSchema } from "../../shared/dossier.ts";

export const STAGE_KEYS = BOARD_STAGES;

export type StageKey = (typeof STAGE_KEYS)[number];

const salarySchema = z.object({
  currency: z.string().nullable(),
  maxMinor: z.number().nullable(),
  minMinor: z.number(),
  period: z.string().nullable(),
});

const noteSchema = z.object({
  label: z.string(),
  tone: z.string(),
});

export const boardCardSchema = z.object({
  ageDays: z.number(),
  company: z.string(),
  id: z.string(),
  location: z.string().nullable(),
  logoUrl: z.string().nullable().optional(),
  needsYou: z.boolean(),
  note: noteSchema.nullable(),
  position: z.number().nullable(),
  salary: salarySchema.nullable(),
  score: z.number().nullable(),
  sentAt: z.number().nullable(),
  stage: z.enum(STAGE_KEYS).nullable(),
  stageLocked: z.boolean(),
  status: z.string(),
  strong: z.boolean(),
  title: z.string(),
  updatedAt: z.number(),
});

export type BoardCard = z.infer<typeof boardCardSchema>;

const boardResponseSchema = z.object({
  columns: z.array(
    z.object({
      cards: z.array(boardCardSchema),
      stage: z.enum(STAGE_KEYS),
    }),
  ),
  total: z.number(),
  updatedAt: z.number(),
});

export type BoardResponse = z.infer<typeof boardResponseSchema>;

const timelineEventSchema = z.object({
  applicationId: z.string(),
  at: z.number(),
  detail: z.string().nullable(),
  fromValue: z.string().nullable(),
  id: z.string(),
  kind: z.enum(["status", "stage", "email", "checkin", "note"]),
  source: z.enum(["system", "user", "email", "checkin", "admin"]),
  toValue: z.string().nullable(),
  userId: z.string(),
});

const answerSchema = z.object({
  answer: z.string().nullable(),
  fact_key: z.string().nullable(),
  fact_revision: z.number().nullable(),
  kind: z.string(),
  label: z.string(),
  question_id: z.string(),
  resume_line_ids: z.array(z.string()),
});

const coverLetterLineSchema = z.object({
  resume_line_ids: z.array(z.string()),
  sentence: z.string(),
});

const mailMessageSchema = z.object({
  at: z.number(),
  classification: z.string().nullable(),
  direction: z.enum(["in", "out"]),
  from: z.string(),
  id: z.string(),
  snippet: z.string(),
  subject: z.string(),
});

const mailThreadSchema = z.object({
  id: z.string(),
  lastMessageAt: z.number(),
  messages: z.array(mailMessageSchema),
  subject: z.string(),
});

export const applicationDetailSchema = z.object({
  ageDays: z.number(),
  application: z.object({
    closedReason: z.string().nullable(),
    createdAt: z.number(),
    id: z.string(),
    sentAt: z.number().nullable(),
    statusReason: z.string().nullable(),
    stage: z.enum(STAGE_KEYS).nullable(),
    stageLocked: z.boolean(),
    status: z.string(),
    updatedAt: z.number(),
  }),
  company: z.string(),
  companyLogoUrl: z.string().nullable().optional(),
  dossier: dossierSchema.nullable(),
  mail: z.array(mailThreadSchema),
  match: z
    .object({ reason: z.string().nullable(), score: z.number().nullable(), strong: z.boolean() })
    .nullable(),
  note: noteSchema.nullable(),
  posting: z.object({
    applyUrl: z.string().nullable(),
    ats: z.string().nullable(),
    id: z.string(),
    location: z.string().nullable(),
    salaryCurrency: z.string().nullable(),
    salaryMaxMinor: z.number().nullable(),
    salaryMinMinor: z.number().nullable(),
    salaryPeriod: z.string().nullable(),
    title: z.string(),
    url: z.string(),
  }),
  timeZone: z.string(),
  snapshot: z
    .object({
      answers: z.array(answerSchema),
      confirmedBy: z.string(),
      consentVersion: z.string(),
      costMicros: z.number(),
      coverLetter: z.array(coverLetterLineSchema).nullable(),
      provider: z.string(),
      resume: z.object({ bytes: z.number(), filename: z.string(), sha256: z.string() }).nullable(),
      resumeLines: z.array(z.object({ id: z.string(), text: z.string() })),
      resumeSha256: z.string(),
      submittedAt: z.number(),
    })
    .nullable(),
  timeline: z.array(timelineEventSchema),
});

export type ApplicationDetail = z.infer<typeof applicationDetailSchema>;

export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export type SnapshotAnswer = z.infer<typeof answerSchema>;

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`The Board request did not go through (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return body;
}

const mutationResultSchema = z.object({
  stage: z.string().nullable().optional(),
  stageLocked: z.boolean().optional(),
  status: z.string().optional(),
});

export async function fetchBoard() {
  return boardResponseSchema.parse(await jsonFrom(await fetch("/api/board")));
}

export async function fetchApplication(id: string) {
  return applicationDetailSchema.parse(
    await jsonFrom(await fetch(`/api/applications/${encodeURIComponent(id)}`)),
  );
}

export async function moveStage(input: { id: string; stage: StageKey; position?: number | null }) {
  return mutationResultSchema.parse(
    await jsonFrom(
      await fetch(`/api/applications/${encodeURIComponent(input.id)}/stage`, {
        body: JSON.stringify({ position: input.position ?? null, stage: input.stage }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    ),
  );
}

export async function undoStage(id: string) {
  return mutationResultSchema.parse(
    await jsonFrom(
      await fetch(`/api/applications/${encodeURIComponent(id)}/undo-stage`, { method: "POST" }),
    ),
  );
}

export async function withdrawApplication(id: string) {
  return mutationResultSchema.parse(
    await jsonFrom(
      await fetch(`/api/applications/${encodeURIComponent(id)}/withdraw`, { method: "POST" }),
    ),
  );
}

export function useBoard() {
  return useQuery({ queryFn: fetchBoard, queryKey: ["board"] });
}

export function useApplication(id: string | null) {
  return useQuery({
    enabled: id !== null,
    queryFn: async () => fetchApplication(id ?? ""),
    queryKey: ["application", id],
  });
}

export function useMoveStage() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: moveStage,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["board"] }),
        client.invalidateQueries({ queryKey: ["application", variables.id] }),
        client.invalidateQueries({ queryKey: ["home"] }),
        client.invalidateQueries({ queryKey: ["calendar"] }),
        client.invalidateQueries({ queryKey: ["nav"] }),
        client.invalidateQueries({ queryKey: ["ready"] }),
      ]);
    },
  });
}

export function useUndoStage() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: undoStage,
    onSuccess: async (_data, id) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["board"] }),
        client.invalidateQueries({ queryKey: ["application", id] }),
        client.invalidateQueries({ queryKey: ["home"] }),
        client.invalidateQueries({ queryKey: ["calendar"] }),
        client.invalidateQueries({ queryKey: ["nav"] }),
        client.invalidateQueries({ queryKey: ["ready"] }),
      ]);
    },
  });
}

export function useWithdraw() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: withdrawApplication,
    onSuccess: async (_data, id) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["board"] }),
        client.invalidateQueries({ queryKey: ["application", id] }),
        client.invalidateQueries({ queryKey: ["home"] }),
        client.invalidateQueries({ queryKey: ["calendar"] }),
        client.invalidateQueries({ queryKey: ["nav"] }),
        client.invalidateQueries({ queryKey: ["ready"] }),
      ]);
    },
  });
}
