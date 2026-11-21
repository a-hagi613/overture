import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { codeWaits, messages } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";

export const CODE_WAIT_TIMEOUT_MS = 10 * 60_000;

export const CODE_PASTE_ASK_MS = 5 * 60_000;

const CODE_WAIT_POLL_MS = 5000;

const waitListeners = new Map<string, Set<() => void>>();

function announce(waitId: string) {
  for (const listener of waitListeners.get(waitId) ?? []) {
    listener();
  }
}

export function onCodeWaitChanged(waitId: string, listener: () => void) {
  const listeners = waitListeners.get(waitId) ?? new Set();

  listeners.add(listener);
  waitListeners.set(waitId, listeners);

  return () => {
    const current = waitListeners.get(waitId);

    if (current === undefined) {
      return;
    }

    current.delete(listener);

    if (current.size === 0) {
      waitListeners.delete(waitId);
    }
  };
}

export function wakeCodeWaits() {
  for (const waitId of waitListeners.keys()) {
    announce(waitId);
  }
}

export function markCodeConsumed(db: AppDatabase, clock: Clock, messageId: string) {
  db.update(messages)
    .set({ codeConsumedAt: new Date(clock.now()) })
    .where(eq(messages.id, messageId))
    .run();
}

interface CodeWaitResolution {
  code: string;
  messageId: string | null;
}

export async function waitForCode(
  deps: { db: AppDatabase; clock: Clock; personal: PersonalCrypto },
  input: { waitId: string; onAskToPaste: () => void },
) {
  const { db, clock, personal } = deps;

  const wait = db.select().from(codeWaits).where(eq(codeWaits.id, input.waitId)).get();

  if (wait === undefined) {
    return null;
  }

  const waitId = wait.id;
  const askAt = wait.startedAt.getTime() + CODE_PASTE_ASK_MS;
  const expiresAt = wait.expiresAt.getTime();

  return new Promise<CodeWaitResolution | null>((resolve) => {
    let settled = false;
    let asked = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: (() => void) | null = null;

    function finish(result: CodeWaitResolution | null) {
      if (settled) {
        return;
      }

      settled = true;

      if (timer !== null) {
        clearInterval(timer);
      }

      unsubscribe?.();
      resolve(result);
    }

    async function check() {
      if (settled) {
        return;
      }

      const row = db.select().from(codeWaits).where(eq(codeWaits.id, waitId)).get();

      if (row === undefined) {
        finish(null);

        return;
      }

      if (row.resolvedAt !== null && row.codeEnc !== null) {
        const code = await personal
          .openFor(
            row.userId,
            { table: "code_waits", column: "code_enc", rowId: row.id },
            row.codeEnc,
          )
          .catch(() => null);

        finish(code === null ? null : { code, messageId: row.resolvedMessageId });

        return;
      }

      const now = clock.now();

      if (!asked && now >= askAt) {
        asked = true;
        input.onAskToPaste();
      }

      if (now >= expiresAt) {
        finish(null);
      }
    }

    unsubscribe = onCodeWaitChanged(waitId, () => {
      void check();
    });

    timer = setInterval(() => {
      void check();
    }, CODE_WAIT_POLL_MS);

    void check();
  });
}

export function createCodeWait(
  db: AppDatabase,
  clock: Clock,
  input: { userId: string; mailboxId: string; attemptId: string | null },
) {
  const id = crypto.randomUUID();
  const startedAt = clock.now();

  db.insert(codeWaits)
    .values({
      id,
      userId: input.userId,
      mailboxId: input.mailboxId,
      attemptId: input.attemptId,
      startedAt: new Date(startedAt),
      expiresAt: new Date(startedAt + CODE_WAIT_TIMEOUT_MS),
    })
    .run();

  return db.select().from(codeWaits).where(eq(codeWaits.id, id)).get();
}

export function openCodeWaits(db: AppDatabase, clock: Clock, mailboxId: string) {
  return db
    .select()
    .from(codeWaits)
    .where(
      and(
        eq(codeWaits.mailboxId, mailboxId),
        isNull(codeWaits.resolvedAt),
        gt(codeWaits.expiresAt, new Date(clock.now())),
      ),
    )
    .orderBy(asc(codeWaits.startedAt))
    .all();
}

export async function resolveOpenWaitForMessage(
  deps: { db: AppDatabase; clock: Clock; personal: PersonalCrypto },
  input: {
    userId: string;
    mailboxId: string;
    code: string;
    messageId: string;
    receivedAt: number;
  },
) {
  const { db, clock, personal } = deps;

  const wait = db
    .select()
    .from(codeWaits)
    .where(
      and(
        eq(codeWaits.mailboxId, input.mailboxId),
        isNull(codeWaits.resolvedAt),
        gt(codeWaits.expiresAt, new Date(input.receivedAt)),
        lte(codeWaits.startedAt, new Date(input.receivedAt)),
      ),
    )
    .orderBy(asc(codeWaits.startedAt))
    .get();

  if (wait === undefined) {
    return null;
  }

  const codeEnc = await personal.sealFor(
    input.userId,
    { table: "code_waits", column: "code_enc", rowId: wait.id },
    input.code,
  );

  const resolvedAt = new Date(clock.now());

  db.update(codeWaits)
    .set({ resolvedAt, resolvedBy: "mail", resolvedMessageId: input.messageId, codeEnc })
    .where(eq(codeWaits.id, wait.id))
    .run();

  publishEvent(
    db,
    clock,
    "code.wait_resolved",
    JSON.stringify({ waitId: wait.id, resolvedBy: "mail" }),
    input.userId,
  );

  announce(wait.id);

  return { waitId: wait.id, resolvedAt, resolvedBy: "mail" as const };
}

export async function resolveCodeWaitWithPaste(
  deps: { db: AppDatabase; clock: Clock; personal: PersonalCrypto },
  input: { userId: string; waitId: string; code: string },
) {
  const { db, clock, personal } = deps;

  const wait = db
    .select()
    .from(codeWaits)
    .where(and(eq(codeWaits.id, input.waitId), eq(codeWaits.userId, input.userId)))
    .get();

  if (wait === undefined) {
    return { outcome: "not_found" as const };
  }

  if (wait.resolvedAt !== null) {
    return { outcome: "already_resolved" as const };
  }

  if (wait.expiresAt.getTime() <= clock.now()) {
    return { outcome: "expired" as const };
  }

  const codeEnc = await personal.sealFor(
    input.userId,
    { table: "code_waits", column: "code_enc", rowId: wait.id },
    input.code,
  );

  const resolvedAt = new Date(clock.now());

  db.update(codeWaits)
    .set({ resolvedAt, resolvedBy: "paste", codeEnc })
    .where(eq(codeWaits.id, wait.id))
    .run();

  publishEvent(
    db,
    clock,
    "code.wait_resolved",
    JSON.stringify({ waitId: wait.id, resolvedBy: "paste" }),
    input.userId,
  );

  announce(wait.id);

  return {
    outcome: "resolved" as const,
    waitId: wait.id,
    resolvedAt,
    resolvedBy: "paste" as const,
  };
}
