import type { AppDatabase } from "./db/client.ts";
import type { Clock } from "./ports/clock.ts";
import { publishEvent } from "./sse/stream.ts";

export const ALERT_KINDS = ["llm.cap"] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertDetail = Record<string, string | number | boolean | null>;

export function raiseAlert(db: AppDatabase, clock: Clock, kind: AlertKind, detail: AlertDetail) {
  publishEvent(db, clock, "alert.raised", JSON.stringify({ kind, detail }));
}
