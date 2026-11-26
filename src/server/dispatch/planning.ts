import { localDayStart, nextLocalDayStart } from "../platform/local-time.ts";

export interface PlanSendSlotsInput {
  now: number;
  timeZone: string;
  count: number;
  spacingMs: number;
  dailyCap: number;
  /** Sends already counted against today's cap (ledger or attempts). */
  usedToday: number;
  /** Approved Applications that already hold a send time. */
  scheduled: readonly number[];
  earliest?: number;
}

interface DayUse {
  count: number;
  latest: number;
}

/**
 * Places approved Applications in order: the first at `earliest` (or now), each
 * following one a spacing apart. A spacing of zero places them all at the same
 * instant, which is how the onboarding trial's three Applications go in parallel.
 *
 * The daily cap still applies. When a day's sends run out, the next Application
 * waits for local midnight, when the cap resets, never a daytime send window.
 * Times that other approved Applications already hold are respected, so a later
 * run cannot place a send on top of one.
 * @param input The instant, the zone, how many to place, the spacing, the daily cap, today's used sends, the times already held and an optional earliest slot.
 * @returns The send times, in order.
 */
export function planSendSlots(input: PlanSendSlotsInput) {
  const { count, dailyCap, now, spacingMs, timeZone } = input;

  if (count <= 0) {
    return [];
  }

  const cap = Math.max(0, Math.trunc(dailyCap));

  if (cap <= 0) {
    return [];
  }

  const todayStart = localDayStart(now, timeZone);
  const byDay = new Map<number, DayUse>();

  function useOf(day: number) {
    const existing = byDay.get(day);

    if (existing !== undefined) {
      return existing;
    }

    const created: DayUse = { count: 0, latest: 0 };
    byDay.set(day, created);

    return created;
  }

  if (input.usedToday > 0) {
    useOf(todayStart).count += input.usedToday;
  }

  for (const at of input.scheduled) {
    const day = localDayStart(at, timeZone);
    const use = useOf(day);

    use.count += 1;
    use.latest = Math.max(use.latest, at);
  }

  const slots: number[] = [];
  let cursor = Math.max(now, input.earliest ?? 0, 0);
  let guard = 0;

  while (slots.length < count && guard < 10_000) {
    guard += 1;

    const day = localDayStart(cursor, timeZone);
    const use = useOf(day);

    if (use.count >= cap) {
      cursor = Math.max(nextLocalDayStart(day, timeZone), use.latest + spacingMs);

      continue;
    }

    if (use.latest > 0 && use.count > 0) {
      const spaced = use.latest + Math.max(0, spacingMs);

      if (spaced > cursor) {
        cursor = spaced;

        continue;
      }
    }

    const slot = Math.max(cursor, now);

    slots.push(slot);
    use.count += 1;
    use.latest = slot;
    cursor = slot + Math.max(0, spacingMs);
  }

  return slots;
}
