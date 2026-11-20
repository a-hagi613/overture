import { and, gt, isNull, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { events } from "../db/schema.ts";

const HEARTBEAT_INTERVAL_MS = 25_000;
const RETENTION_MS = 24 * 60 * 60_000;

export function publishEvent(
  db: AppDatabase,
  clock: Clock,
  topic: string,
  payload: string,
  userId?: string,
) {
  db.insert(events)
    .values({
      userId: userId ?? null,
      topic,
      payload,
      createdAt: clock.now(),
    })
    .run();
}

export function purgeOldEvents(db: AppDatabase, clock: Clock) {
  const cutoff = clock.now() - RETENTION_MS;

  db.delete(events)
    .where(sql`${events.createdAt} < ${cutoff}`)
    .run();
}

function formatSseMessage(seq: number, topic: string, payload: string) {
  return `id:${String(seq)}\nevent:${topic}\ndata:${payload}\n\n`;
}

export function createSseStream(
  db: AppDatabase,
  _clock: Clock,
  lastEventId: string | null,
  userId: string | null,
  signal: AbortSignal,
) {
  let lastSeq = lastEventId === null ? 0 : Math.trunc(Number(lastEventId));

  if (Number.isNaN(lastSeq)) {
    lastSeq = 0;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function sendChunk(text: string) {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      }

      function poll() {
        const userFilter =
          userId === null
            ? isNull(events.userId)
            : or(isNull(events.userId), sql`${events.userId} = ${userId}`);

        const rows = db
          .select()
          .from(events)
          .where(and(gt(events.seq, lastSeq), userFilter))
          .orderBy(events.seq)
          .limit(100)
          .all();

        for (const row of rows) {
          lastSeq = row.seq;
          sendChunk(formatSseMessage(row.seq, row.topic, row.payload));
        }
      }

      function heartbeat() {
        sendChunk(`: heartbeat\n\n`);
      }

      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      function cleanup() {
        if (pollTimer !== null) {
          clearInterval(pollTimer);
          pollTimer = null;
        }

        if (heartbeatTimer !== null) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        try {
          controller.close();
        } catch {}
      }

      signal.addEventListener("abort", cleanup);

      poll();

      pollTimer = setInterval(poll, 1000);
      heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    },
  });

  return stream;
}
