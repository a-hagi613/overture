const waiters = new Set<() => void>();

let released = false;

export async function waitForBlockingRelease(payload: string) {
  await Promise.resolve(payload);

  if (!released) {
    await new Promise<void>((resolve) => {
      waiters.add(resolve);
    });
  }
}

export function releaseBlockingJobs() {
  released = true;

  for (const resolve of waiters) {
    resolve();
  }

  waiters.clear();
}
