import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { probeForms } from "../platform/db/schema.ts";

export interface ProbeFormRecord {
  id: string;
  postingUrl: string;
  company: string;
  title: string;
  confirmMode: boolean;
  outcome: string;
  submitted: boolean;
  confirmationSeen: boolean;
  codeAsked: boolean;
  submitResponseStatus: number | null;
  proxyMb: number;
  browserMinutes: number;
  costUsd: number;
  sessionId: string | null;
  createdAt: number;
}

export type ProbeDatabase = ReturnType<typeof openProbeDatabase>;

export function openProbeDatabase(path: string) {
  const { db } = openDatabase(path);

  migrateDatabase(db, "drizzle");

  return { db };
}

export function recordProbeForm(db: ProbeDatabase["db"], record: ProbeFormRecord) {
  db.insert(probeForms)
    .values({
      id: record.id,
      postingUrl: record.postingUrl,
      company: record.company,
      title: record.title,
      confirmMode: record.confirmMode ? 1 : 0,
      outcome: record.outcome,
      submitted: record.submitted ? 1 : 0,
      confirmationSeen: record.confirmationSeen ? 1 : 0,
      codeAsked: record.codeAsked ? 1 : 0,
      submitResponseStatus: record.submitResponseStatus,
      proxyMb: record.proxyMb,
      browserMinutes: record.browserMinutes,
      costUsd: record.costUsd,
      sessionId: record.sessionId,
      createdAt: record.createdAt,
    })
    .run();
}

export function readProbeForms(db: ProbeDatabase["db"]) {
  return db.select().from(probeForms).all();
}
