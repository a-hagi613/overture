import { and, gt, isNull, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { logError } from "../log.ts";
import { events } from "../db/schema.ts";

const HEARTBEAT_INTERVAL_MS = 25_000;
const POLL_INTERVAL_MS = 1000;
const POLL_ERROR_LOG_INTERVAL_MS = 10_000;

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

function formatSseMessage(seq: number, topic: string, payload: string) {
  return `id:${String(seq)}\nevent:${topic}\ndata:${payload}\n\n`;
}

export function createSseStream(
  db: AppDatabase,
  clock: Clock,
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
      let lastPollErrorAt: number | null = null;

      function sendChunk(text: string) {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      }

      function logPollError(cause: unknown) {
        const now = clock.now();

        if (lastPollErrorAt !== null && now - lastPollErrorAt < POLL_ERROR_LOG_INTERVAL_MS) {
          return;
        }

        lastPollErrorAt = now;
        logError("sse.poll", cause);
      }

      function poll() {
        try {
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
        } catch (error) {
          logPollError(error);
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

      pollTimer = setInterval(poll, POLL_INTERVAL_MS);
      heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    },
  });

  return stream;
}
