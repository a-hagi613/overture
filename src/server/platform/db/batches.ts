export const WRITE_BATCH_ROWS = 500;

export async function yieldToEventLoop() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
