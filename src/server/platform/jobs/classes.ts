export type JobClass = "browser" | "llm" | "fast";

const JOB_CLASSES: readonly JobClass[] = ["browser", "fast", "llm"];

const BROWSER_JOB_KINDS: readonly string[] = [
  "application.send",
  "fixtures.capture",
  "lab.run",
  "live.check",
];

const LLM_JOB_KINDS: readonly string[] = ["application.prepare", "tag.llm_fallback"];

/**
 * Per-class in-flight limits. A class at its limit is left out of the claim query,
 * so its older rows cannot hide a fast job behind them. The browser lane matches
 * the default process-wide session cap, so a stalled browser vendor never owns the
 * worker, and sends never queue behind preparation in the same lane.
 */
export const DEFAULT_JOB_CLASS_LIMITS: Readonly<Record<JobClass, number>> = {
  browser: 3,
  llm: 3,
  fast: 8,
};

/** The whole worker, across every class, never holds more than this many jobs. */
export const DEFAULT_MAX_IN_FLIGHT_JOBS = 10;

/** How many browser jobs run when the owner leaves the session cap at zero (uncapped). */
export const UNCAPPED_BROWSER_JOBS = 12;

/**
 * The per-class limits for the browser cap the owner set. Zero sessions means
 * the provider and the box bound browser work, so the lane gets a generous
 * bound instead of the default three; a configured cap is used exactly.
 * @param sessionLimit The configured session cap, or null for uncapped.
 * @returns The limits for every class.
 */
export function jobClassLimits(sessionLimit: number | null) {
  return {
    ...DEFAULT_JOB_CLASS_LIMITS,
    browser: sessionLimit ?? UNCAPPED_BROWSER_JOBS,
  } satisfies Record<JobClass, number>;
}

/**
 * The total in-flight bound that leaves room for every class limit, so a
 * browser cap above the default is not silently cut by the worker-wide bound.
 * @param limits The per-class limits.
 * @returns The total jobs one worker may hold.
 */
export function maxInFlightFor(limits: Readonly<Record<JobClass, number>>) {
  return Math.max(DEFAULT_MAX_IN_FLIGHT_JOBS, limits.browser + limits.llm + limits.fast);
}

/** For the test-only route that must run every due job at once (ADR 0013). */
export const NO_JOB_CLASS_LIMITS: Readonly<Record<JobClass, number>> = {
  browser: Number.POSITIVE_INFINITY,
  fast: Number.POSITIVE_INFINITY,
  llm: Number.POSITIVE_INFINITY,
};

const KINDS_BY_CLASS: Readonly<Record<JobClass, readonly string[]>> = {
  browser: BROWSER_JOB_KINDS,
  llm: LLM_JOB_KINDS,
  fast: [],
};

/**
 * Which lane a job kind belongs to.
 * @param kind The job kind kept in `bg_jobs.kind`.
 * @returns The browser or LLM lane for a heavy vendor kind, `fast` otherwise.
 */
export function jobClassOf(kind: string) {
  if (BROWSER_JOB_KINDS.includes(kind)) {
    return "browser";
  }

  if (LLM_JOB_KINDS.includes(kind)) {
    return "llm";
  }

  return "fast";
}

/**
 * How many jobs of each class the given kinds occupy.
 * @param kinds Job kinds, from the worker's in-flight set.
 * @returns The count per class.
 */
export function jobClassCounts(kinds: readonly string[]) {
  const counts: Record<JobClass, number> = { browser: 0, fast: 0, llm: 0 };

  for (const kind of kinds) {
    counts[jobClassOf(kind)] += 1;
  }

  return counts;
}

/**
 * The known kinds of every class that is already at its in-flight limit. The claim
 * query skips them, so a saturated slow lane cannot push a fast job out of the batch.
 * @param counts How many jobs of each class are in flight.
 * @param limits The per-class limits.
 * @returns The kinds to leave out of this claim.
 */
export function saturatedJobKinds(
  counts: Readonly<Record<JobClass, number>>,
  limits: Readonly<Record<JobClass, number>> = DEFAULT_JOB_CLASS_LIMITS,
) {
  return JOB_CLASSES.flatMap((jobClass) =>
    counts[jobClass] >= limits[jobClass] ? KINDS_BY_CLASS[jobClass] : [],
  );
}

/**
 * Whether starting one more job of `kind` would exceed its class limit.
 * @param kind The job kind about to start.
 * @param counts How many jobs of each class already run or were started in this claim.
 * @param limits The per-class limits.
 * @returns True when the job must wait for the next claim.
 */
export function exceedsJobClassLimit(
  kind: string,
  counts: Readonly<Record<JobClass, number>>,
  limits: Readonly<Record<JobClass, number>> = DEFAULT_JOB_CLASS_LIMITS,
) {
  const jobClass = jobClassOf(kind);

  return counts[jobClass] >= limits[jobClass];
}
