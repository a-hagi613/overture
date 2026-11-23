import { desc, gt } from "drizzle-orm";

import type { AppDatabase, DatabaseWriter } from "../db/client.ts";

import { logError } from "../log.ts";
import { events } from "../db/schema.ts";

const POLL_INTERVAL_MS = 1000;
const PAGE_ROWS = 200;
const PAGES_PER_PASS = 5;
const REPLAY_ROW_LIMIT = 200;

export interface EventRow {
  seq: number;
  topic: string;
  payload: string;
}

export interface EventSubscriber {
  userId: string;
  lastSeq: number;
  deliver: (row: EventRow) => void;
}

function boundedReplayFloor(db: AppDatabase, lastSeq: number) {
  const floor = Number.isFinite(lastSeq) ? Math.max(0, Math.trunc(lastSeq)) : 0;

  const newest =
    db.select({ seq: events.seq }).from(events).orderBy(desc(events.seq)).limit(1).get()?.seq ?? 0;

  const oldestKept = Math.max(0, newest - REPLAY_ROW_LIMIT);

  return floor < oldestKept ? oldestKept : floor;
}

function createHub(db: AppDatabase) {
  const subscribers = new Set<EventSubscriber>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let wakePending = false;
  let failing = false;

  function logPollError(cause: unknown) {
    if (failing) {
      return;
    }

    failing = true;
    logError("sse.poll", cause);
  }

  function pass() {
    try {
      for (let page = 0; page < PAGES_PER_PASS && subscribers.size > 0; page += 1) {
        const floor = Math.min(...[...subscribers].map((subscriber) => subscriber.lastSeq));

        const rows = db
          .select()
          .from(events)
          .where(gt(events.seq, floor))
          .orderBy(events.seq)
          .limit(PAGE_ROWS)
          .all();

        for (const row of rows) {
          for (const subscriber of subscribers) {
            if (row.seq <= subscriber.lastSeq) {
              continue;
            }

            subscriber.lastSeq = row.seq;

            if (row.userId !== subscriber.userId) {
              continue;
            }

            subscriber.deliver(row);
          }
        }

        if (rows.length < PAGE_ROWS) {
          break;
        }
      }

      failing = false;
    } catch (error) {
      logPollError(error);
    }
  }

  function wake() {
    if (wakePending || subscribers.size === 0) {
      return;
    }

    wakePending = true;

    setTimeout(() => {
      wakePending = false;
      pass();
    }, 0);
  }

  function subscribe(subscriber: EventSubscriber) {
    subscriber.lastSeq = boundedReplayFloor(db, subscriber.lastSeq);
    subscribers.add(subscriber);

    timer ??= setInterval(pass, POLL_INTERVAL_MS);

    pass();

    return () => {
      subscribers.delete(subscriber);

      if (subscribers.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }

  return { subscribe, wake };
}

const hubs = new WeakMap<DatabaseWriter, ReturnType<typeof createHub>>();

function hubFor(db: AppDatabase) {
  const existing = hubs.get(db);

  if (existing !== undefined) {
    return existing;
  }

  const created = createHub(db);

  hubs.set(db, created);

  return created;
}

export function subscribeToEvents(db: AppDatabase, subscriber: EventSubscriber) {
  return hubFor(db).subscribe(subscriber);
}

export function wakeEventHub(db: DatabaseWriter) {
  hubs.get(db)?.wake();
}
