function describe(cause: unknown) {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }

  return String(cause);
}

export function logError(scope: string, cause: unknown) {
  process.stderr.write(`overture ${scope}: ${describe(cause)}\n`);
}

export function logRetry(scope: string, attempt: number, cause: unknown) {
  process.stderr.write(
    `overture ${scope}: attempt ${String(attempt)} hit ${describe(cause)}; retrying\n`,
  );
}
