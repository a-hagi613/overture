import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { codeWaits } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";

export const CODE_WAIT_TIMEOUT_MS = 10 * 60_000;

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

  return {
    outcome: "resolved" as const,
    waitId: wait.id,
    resolvedAt,
    resolvedBy: "paste" as const,
  };
}
