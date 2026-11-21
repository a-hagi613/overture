import { desc } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { labRuns } from "../platform/db/schema.ts";

export const LAB_OUTCOMES = ["completed", "challenge_blocked", "error"] as const;

export type LabOutcome = (typeof LAB_OUTCOMES)[number];

export type LabProvider = "browser_use" | "kernel" | "local";

export interface LabRunRecord {
  provider: LabProvider;
  page: "recaptcha_v3" | "hcaptcha" | "turnstile" | "form";
  ats: string | null;
  outcome: LabOutcome;
  challengeSeen: boolean;
  codeAsked: boolean;
  captchaScore: number | null;
  durationMs: number;
  proxyBytes: number | null;
  costMicros: number | null;
  sessionId: string | null;
  startedAt: number;
  endedAt: number;
  errorCode: string | null;
}

export function recordLabRun(db: AppDatabase, clock: Clock, runId: string, record: LabRunRecord) {
  db.insert(labRuns)
    .values({
      ats: record.ats,
      captchaScore: record.captchaScore,
      challengeSeen: record.challengeSeen,
      codeAsked: record.codeAsked,
      costMicros: record.costMicros,
      createdAt: clock.now(),
      durationMs: record.durationMs,
      endedAt: record.endedAt,
      errorCode: record.errorCode,
      id: crypto.randomUUID(),
      outcome: record.outcome,
      page: record.page,
      provider: record.provider,
      proxyBytes: record.proxyBytes,
      runId,
      sessionId: record.sessionId,
      startedAt: record.startedAt,
    })
    .run();
}

export function readLabRuns(db: AppDatabase) {
  return db.select().from(labRuns).orderBy(desc(labRuns.startedAt)).all();
}
