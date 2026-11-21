import { z } from "zod";

export const SWEEP_RUN_KINDS = ["sweep", "backfill", "workable"] as const;

export type SweepRunKind = (typeof SWEEP_RUN_KINDS)[number];

export const workableIngestReportSchema = z.object({
  outcome: z.enum([
    "ingested",
    "unchanged",
    "already_ingested",
    "kill_switch",
    "missing_manifest",
    "missing_snapshot",
    "stale",
  ]),
  snapshot: z.string().nullable(),
  rows: z.number(),
  added: z.number(),
  updated: z.number(),
  closed: z.number(),
  ageMs: z.number().nullable(),
  previousRows: z.number().nullable(),
  dropped: z.boolean(),
});

export const sweepRunSummarySchema = z.object({
  kind: z.enum(SWEEP_RUN_KINDS),
  boards: z.number(),
  polled: z.number(),
  notModified: z.number(),
  gone: z.number(),
  errors: z.number(),
  added: z.number(),
  updated: z.number(),
  closed: z.number(),
  durationMs: z.number(),
  workable: workableIngestReportSchema.nullish(),
});

export type SweepRunSummary = z.infer<typeof sweepRunSummarySchema>;

export const sweepRunRequestSchema = z.object({
  type: z.literal("run"),
  id: z.string().min(1),
  kind: z.enum(SWEEP_RUN_KINDS),
  offsetMs: z.number(),
});

export type SweepRunRequest = z.infer<typeof sweepRunRequestSchema>;

export interface SweepWorkerReady {
  type: "ready";
}

export interface SweepWorkerDone {
  type: "done";
  id: string;
  summary: SweepRunSummary;
}

export interface SweepWorkerFailed {
  type: "failed";
  id: string;
  error: string;
}

export type SweepWorkerResponse = SweepWorkerReady | SweepWorkerDone | SweepWorkerFailed;

export const sweepWorkerResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("done"), id: z.string().min(1), summary: sweepRunSummarySchema }),
  z.object({ type: z.literal("failed"), id: z.string().min(1), error: z.string() }),
]);
