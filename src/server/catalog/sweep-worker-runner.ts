import type { AppDatabase } from "../platform/db/client.ts";
import type { AdjustableClock } from "../platform/ports/clock.ts";
import type {
  SweepRunKind,
  SweepRunRequest,
  SweepRunSummary,
  SweepWorkerResponse,
} from "./sweep-worker-protocol.ts";

import { raiseAlert } from "../platform/alerts.ts";
import { logError } from "../platform/log.ts";
import { recordCatalogWorkerCrash } from "./worker-restarts.ts";
import { sweepWorkerResponseSchema } from "./sweep-worker-protocol.ts";

const CRASH_BACKOFF_BASE_MS = 250;
const CRASH_BACKOFF_MAX_MS = 30_000;
const CRASH_ALERT_COOLDOWN_MS = 60_000;
const READY_TIMEOUT_MS = 30_000;

export interface CatalogSweepWorkerStatus {
  running: boolean;
  restarts: number;
}

export interface CatalogSweepWorker {
  run: (kind: SweepRunKind) => Promise<SweepRunSummary>;
  stop: () => void;
  crash: () => boolean;
  status: () => CatalogSweepWorkerStatus;
}

interface WorkerConnection {
  worker: Worker;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
}

interface PendingRun {
  connection: WorkerConnection;
  resolve: (summary: SweepRunSummary) => void;
  reject: (error: Error) => void;
}

async function logReadyFailure(ready: Promise<void>, timer: ReturnType<typeof setTimeout>) {
  try {
    await ready;
  } catch (error) {
    logError("catalog.worker.ready", error);
  } finally {
    clearTimeout(timer);
  }
}

export function createCatalogSweepWorker(deps: { db: AppDatabase; clock: AdjustableClock }) {
  const runs = new Map<string, PendingRun>();

  let connection: WorkerConnection | null = null;
  let scheduledRestart: Promise<void> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let restartCount = 0;
  let stopping = false;
  let lastAlertAt: number | null = null;

  function handleMessage(from: WorkerConnection, message: SweepWorkerResponse) {
    if (message.type === "ready") {
      from.resolveReady();

      return;
    }

    const pending = runs.get(message.id);

    if (pending === undefined || pending.connection !== from) {
      return;
    }

    runs.delete(message.id);

    if (message.type === "done") {
      pending.resolve(message.summary);
    } else {
      pending.reject(new Error(message.error));
    }
  }

  function connect() {
    const worker = new Worker(new URL("sweep-worker.ts", import.meta.url).href, {
      name: "catalog-sweep",
    });

    const deferred = Promise.withResolvers<undefined>();

    const created: WorkerConnection = {
      worker,
      ready: deferred.promise,
      resolveReady: () => {
        deferred.resolve(undefined);
      },
      rejectReady: deferred.reject,
    };

    worker.addEventListener("message", (event: MessageEvent) => {
      const parsed = sweepWorkerResponseSchema.safeParse(event.data);

      if (!parsed.success) {
        logError("catalog.worker.message", parsed.error);

        return;
      }

      handleMessage(created, parsed.data);
    });

    worker.addEventListener("error", (event: ErrorEvent) => {
      logError("catalog.worker", event.error ?? event.message);
    });

    worker.addEventListener("close", () => {
      handleClose(created);
    });

    const readyTimer = setTimeout(() => {
      deferred.reject(new Error("the catalog sweep worker did not become ready in time"));
    }, READY_TIMEOUT_MS);

    readyTimer.unref();
    void logReadyFailure(created.ready, readyTimer);

    return created;
  }

  function rejectPending(from: WorkerConnection, error: Error) {
    for (const [id, pending] of runs) {
      if (pending.connection !== from) {
        continue;
      }

      runs.delete(id);
      pending.reject(error);
    }
  }

  function alertCrash(delayMs: number) {
    const now = deps.clock.now();

    if (lastAlertAt !== null && now - lastAlertAt < CRASH_ALERT_COOLDOWN_MS) {
      return;
    }

    lastAlertAt = now;

    try {
      raiseAlert(deps.db, deps.clock, "catalog.worker", { restarts: restartCount, delayMs });
    } catch (error) {
      logError("catalog.worker.alert", error);
    }
  }

  function scheduleRestart() {
    const delayMs = Math.min(
      CRASH_BACKOFF_BASE_MS * 2 ** Math.max(0, restartCount - 1),
      CRASH_BACKOFF_MAX_MS,
    );

    alertCrash(delayMs);

    scheduledRestart = new Promise<void>((resolve) => {
      restartTimer = setTimeout(() => {
        restartTimer = null;
        scheduledRestart = null;

        if (!stopping) {
          connection = connect();
        }

        resolve();
      }, delayMs);
    });
  }

  function handleClose(from: WorkerConnection) {
    if (connection !== from) {
      return;
    }

    connection = null;
    from.rejectReady(new Error("the catalog sweep worker closed before it was ready"));
    rejectPending(from, new Error("the catalog sweep worker crashed"));

    if (stopping) {
      return;
    }

    restartCount += 1;
    recordCatalogWorkerCrash();
    scheduleRestart();
  }

  async function ensureStarted() {
    if (stopping) {
      throw new Error("the catalog sweep worker is stopping");
    }

    if (connection !== null) {
      return connection;
    }

    if (scheduledRestart !== null) {
      await scheduledRestart;

      return ensureStarted();
    }

    connection = connect();

    return connection;
  }

  async function run(kind: SweepRunKind) {
    const target = await ensureStarted();

    await target.ready;

    if (connection !== target) {
      return run(kind);
    }

    const id = crypto.randomUUID();

    return new Promise<SweepRunSummary>((resolve, reject) => {
      runs.set(id, { connection: target, resolve, reject });
      target.worker.postMessage(
        {
          type: "run",
          id,
          kind,
          offsetMs: deps.clock.offset(),
        } satisfies SweepRunRequest,
        [],
      );
    });
  }

  function stop() {
    stopping = true;

    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }

    scheduledRestart = null;

    const current = connection;

    connection = null;

    if (current !== null) {
      current.rejectReady(new Error("the catalog sweep worker stopped"));
      rejectPending(current, new Error("the catalog sweep worker stopped"));
      current.worker.terminate();
    }
  }

  function crash() {
    const current = connection;

    if (current === null) {
      return false;
    }

    current.worker.terminate();

    return true;
  }

  return {
    run,
    stop,
    crash,
    status: () => ({ running: connection !== null, restarts: restartCount }),
  } satisfies CatalogSweepWorker;
}
