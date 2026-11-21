export const RETRY_LATER_DELAY_MS = 30_000;

export class RetryLaterError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "RetryLaterError";
  }
}
