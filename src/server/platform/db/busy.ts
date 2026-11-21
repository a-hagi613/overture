import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

import { logRetry } from "../log.ts";

const BUSY_PRIMARY_CODE = 5;
const RETRY_ATTEMPTS = 12;
const RETRY_BASE_MS = 50;
const RETRY_MAX_MS = 1000;

const sqliteErrorSchema = z.object({
  code: z.string().optional(),
  errcode: z.number().optional(),
  message: z.string(),
});

export function isSqliteBusy(cause: unknown) {
  const parsed = sqliteErrorSchema.safeParse(cause);

  if (!parsed.success) {
    return false;
  }

  const { code, errcode, message } = parsed.data;

  return (
    code?.startsWith("SQLITE_BUSY") === true ||
    (errcode !== undefined && errcode % 256 === BUSY_PRIMARY_CODE) ||
    message.includes("database is locked")
  );
}

export async function retryWhenBusy<T>(
  operation: () => T | Promise<T>,
  scope: string,
  attemptLimit = RETRY_ATTEMPTS,
) {
  const run: (attempt: number) => Promise<T> = async (attempt) => {
    try {
      return await operation();
    } catch (error) {
      if (!isSqliteBusy(error) || attempt >= attemptLimit) {
        throw error;
      }

      logRetry(scope, attempt, error);

      await delay(Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS));

      return run(attempt + 1);
    }
  };

  return run(1);
}
