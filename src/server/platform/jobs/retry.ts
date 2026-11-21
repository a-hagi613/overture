export const RETRY_LATER_DELAY_MS = 30_000;

export class RetryLaterError extends Error {
  readonly delayMs: number | null;

  constructor(message: string, delayMs?: number) {
    super(message);

    this.name = "RetryLaterError";
    this.delayMs = delayMs ?? null;
  }
}
