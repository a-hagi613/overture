import { and, eq, isNull, lte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";
import type { LiveCheckResult } from "./types.ts";

import { liveCheckMail } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { getSetting } from "../platform/settings/index.ts";

export const LIVE_CHECK_MAIL_JOB_KIND = "live.check.mail";
export const LIVE_CHECK_SUBJECT = "Overture live check";
export const DEFAULT_MAIL_WAIT_MINUTES = 5;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOKEN_PATTERN = /token: (?<token>[0-9a-f-]{16,})/u;
const CODE_PATTERN = /code: (?<code>[A-Z0-9]{8})/u;

export interface MailCheckDeps {
  db: AppDatabase;
  clock: Clock;
  mail: MailSender;
  address: string;
}

export function mailWaitMinutes(db: AppDatabase) {
  const raw = getSetting(db, "live_checks.mail_wait_minutes");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : DEFAULT_MAIL_WAIT_MINUTES;
}

export function liveCheckTokenFromText(text: string) {
  return TOKEN_PATTERN.exec(text)?.groups?.["token"] ?? null;
}

export function liveCheckCodeFromText(text: string) {
  return CODE_PATTERN.exec(text)?.groups?.["code"] ?? null;
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));

  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? "A").join("");
}

export async function sendLiveCheckMail(deps: MailCheckDeps) {
  const startedAt = deps.clock.now();
  const token = crypto.randomUUID();
  const code = newCode();
  const subject = `${LIVE_CHECK_SUBJECT} ${code}`;
  const body = `${LIVE_CHECK_SUBJECT}\n\ntoken: ${token}\ncode: ${code}\n`;

  const id = crypto.randomUUID();

  deps.db
    .insert(liveCheckMail)
    .values({
      id,
      token,
      code,
      toAddress: deps.address,
      sentAt: startedAt,
      receivedAt: null,
      auth: null,
      receivedCode: null,
      resolvedAt: null,
    })
    .run();

  try {
    await deps.mail.sendCheck({ to: deps.address, subject, body });
  } catch (error) {
    deps.db.delete(liveCheckMail).where(eq(liveCheckMail.id, id)).run();

    throw error;
  }

  enqueueJob(deps.db, deps.clock, LIVE_CHECK_MAIL_JOB_KIND, JSON.stringify({ mailId: id }), {
    maxAttempts: 1,
    runAt: startedAt + mailWaitMinutes(deps.db) * 60_000,
  });

  const result = {
    check: "mail.send",
    ok: true,
    startedAt,
    durationMs: deps.clock.now() - startedAt,
    detail: { mailId: id, to: deps.address, token },
  } satisfies LiveCheckResult;

  return { id, result };
}

function markResolved(db: AppDatabase, clock: Clock, id: string) {
  db.update(liveCheckMail).set({ resolvedAt: clock.now() }).where(eq(liveCheckMail.id, id)).run();
}

function resultForRow(row: typeof liveCheckMail.$inferSelect, waitMs: number, now: number) {
  if (row.receivedAt === null) {
    const failed: LiveCheckResult = {
      check: "mail",
      ok: false,
      startedAt: row.sentAt,
      durationMs: Math.max(0, now - row.sentAt),
      detail: {
        error: "the check message did not come back in time",
        mailId: row.id,
        to: row.toAddress,
        token: row.token,
      },
    };

    return failed;
  }

  const codeMatched = row.receivedCode === row.code;
  const withinWindow = row.receivedAt - row.sentAt <= waitMs;
  const ok = row.auth === "pass" && codeMatched && withinWindow;

  const result: LiveCheckResult = {
    check: "mail",
    ok,
    startedAt: row.sentAt,
    durationMs: row.receivedAt - row.sentAt,
    detail: {
      auth: row.auth,
      codeMatched,
      mailId: row.id,
      receivedAt: row.receivedAt,
      to: row.toAddress,
      token: row.token,
      withinWindow,
    },
  };

  return result;
}

export function resolveDueLiveCheckMail(deps: MailCheckDeps) {
  const waitMs = mailWaitMinutes(deps.db) * 60_000;
  const cutoff = deps.clock.now() - waitMs;

  const due = deps.db
    .select()
    .from(liveCheckMail)
    .where(and(isNull(liveCheckMail.resolvedAt), lte(liveCheckMail.sentAt, cutoff)))
    .all();

  return due.map((row) => {
    markResolved(deps.db, deps.clock, row.id);

    return resultForRow(row, waitMs, deps.clock.now());
  });
}

export function resolveLiveCheckMail(deps: MailCheckDeps, mailId: string) {
  const row = deps.db.select().from(liveCheckMail).where(eq(liveCheckMail.id, mailId)).get();

  if (row === undefined || row.resolvedAt !== null) {
    return null;
  }

  const waitMs = mailWaitMinutes(deps.db) * 60_000;

  if (row.receivedAt === null && deps.clock.now() - row.sentAt < waitMs) {
    return null;
  }

  markResolved(deps.db, deps.clock, row.id);

  return resultForRow(row, waitMs, deps.clock.now());
}

export function recordLiveCheckMailInbound(
  db: AppDatabase,
  clock: Clock,
  input: { token: string; auth: "pass" | "fail" | "none"; code: string | null },
) {
  const row = db.select().from(liveCheckMail).where(eq(liveCheckMail.token, input.token)).get();

  if (row === undefined || row.receivedAt !== null || row.resolvedAt !== null) {
    return false;
  }

  db.update(liveCheckMail)
    .set({ receivedAt: clock.now(), auth: input.auth, receivedCode: input.code })
    .where(eq(liveCheckMail.id, row.id))
    .run();

  return true;
}
