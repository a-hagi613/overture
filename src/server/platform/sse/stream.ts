import type { AppDatabase, DatabaseWriter } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { events } from "../db/schema.ts";
import { subscribeToEvents, wakeEventHub } from "./hub.ts";

const HEARTBEAT_INTERVAL_MS = 25_000;

export function publishEvent(
  db: DatabaseWriter,
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

  wakeEventHub(db);
}

function formatSseMessage(seq: number, topic: string, payload: string) {
  return `id:${String(seq)}\nevent:${topic}\ndata:${payload}\n\n`;
}

export function createSseStream(
  db: AppDatabase,
  lastEventId: string | null,
  userId: string,
  signal: AbortSignal,
) {
  const parsed = lastEventId === null ? 0 : Math.trunc(Number(lastEventId));
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;
  const state = { rejected: false };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      let stopped = false;

      function stop() {
        if (stopped) {
          return;
        }

        stopped = true;
        signal.removeEventListener("abort", stop);

        unsubscribe?.();
        unsubscribe = null;

        if (heartbeatTimer !== null) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        try {
          controller.close();
        } catch {}
      }

      cleanup = stop;

      function sendChunk(text: string) {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      }

      signal.addEventListener("abort", stop, { once: true });

      unsubscribe = subscribeToEvents(db, {
        userId,
        lastSeq: Number.isNaN(parsed) ? 0 : parsed,
        deliver: (row) => {
          sendChunk(formatSseMessage(row.seq, row.topic, row.payload));
        },
      });

      if (unsubscribe === null) {
        state.rejected = true;
        stop();

        return;
      }

      heartbeatTimer = setInterval(() => {
        sendChunk(`: heartbeat\n\n`);
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      cleanup?.();
    },
  });

  return state.rejected ? null : stream;
}
