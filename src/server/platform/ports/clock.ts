/**
 * Reads the current time. Every clock read goes through this port so that tests can move time
 * without touching the system clock.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch, including any test offset. */
  now: () => number;
}

/**
 * A clock whose offset a test-only route can move. Production mounts no route that moves it.
 */
export interface AdjustableClock extends Clock {
  /** Moves the clock by the given number of milliseconds from the real time. */
  setOffset: (milliseconds: number) => void;
  /** The current offset in milliseconds. */
  offset: () => number;
}

export function createClock() {
  let currentOffset = 0;

  return {
    now: () => Date.now() + currentOffset,
    setOffset: (milliseconds: number) => {
      currentOffset = milliseconds;
    },
    offset: () => currentOffset,
  };
}
