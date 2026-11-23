import { z } from "zod";

import type { AppServer } from "./app-server.ts";

const DAY_MS = 86_400_000;
const SEND_WINDOW_OPEN_AT = 10 * 3_600_000;

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });
const offsets = new Map<string, number>();

async function readClock(server: Pick<AppServer, "url">) {
  const response = await fetch(`${server.url}/__test__/clock`);

  if (!response.ok) {
    throw new Error(`the fixture clock could not be read (${String(response.status)})`);
  }

  return clockSchema.parse(await response.json());
}

/**
 * Pins the server clock to 10:00 UTC, inside the default 08:00–20:00 send window, so a dispatch test
 * is deterministic no matter what hour CI runs. The offset is cached per server and re-applied after
 * a restart, which keeps the clock moving forward without landing outside the window. Reads the clock
 * back and fails loudly when the pinned time is not inside the window.
 * @param server The app server to pin.
 * @returns The pinned clock reading.
 */
export async function pinSendWindowClock(server: Pick<AppServer, "url">) {
  const before = await readClock(server);
  const cached = offsets.get(server.url);
  const realNow = before.now - before.offsetMs;
  const target = Math.floor(before.now / DAY_MS) * DAY_MS + SEND_WINDOW_OPEN_AT;
  const offsetMs = cached ?? target - realNow;

  offsets.set(server.url, offsetMs);

  if (before.offsetMs !== offsetMs) {
    const response = await fetch(`${server.url}/__test__/clock/offset`, {
      body: JSON.stringify({ offsetMs }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`the fixture clock could not be pinned (${String(response.status)})`);
    }
  }

  const pinned = await readClock(server);
  const minuteOfDay = Math.floor((pinned.now % DAY_MS) / 60_000);

  if (minuteOfDay < 8 * 60 || minuteOfDay >= 20 * 60) {
    throw new Error(
      `the fixture clock is outside the send window (${new Date(pinned.now).toISOString()})`,
    );
  }

  return pinned;
}

/**
 * The offset the send-window pin installed for a server, once it has been pinned.
 * @param server The app server.
 * @returns The pinned offset in milliseconds, or undefined when never pinned.
 */
export function pinnedClockOffset(server: Pick<AppServer, "url">) {
  return offsets.get(server.url);
}

/**
 * Moves the fixture clock to `deltaMs` after the pinned start, rather than replacing the pin with an
 * absolute offset measured from real time. A test that advances six minutes and later eleven means
 * "eleven minutes after the wait opened", not "seventeen"; posting an absolute offset would also jump
 * the clock back into the real hour and outside the send window.
 * @param server The pinned app server.
 * @param owner The request context that posts the offset.
 * @param deltaMs The shift after the pinned start.
 */
export async function setPinnedClockOffset(
  server: Pick<AppServer, "url">,
  owner: {
    post: (url: string, options: { data: { offsetMs: number } }) => Promise<{ ok: () => boolean }>;
  },
  deltaMs: number,
) {
  const base = offsets.get(server.url) ?? 0;

  const response = await owner.post("/__test__/clock/offset", {
    data: { offsetMs: base + deltaMs },
  });

  if (!response.ok()) {
    throw new Error("the fixture clock could not be shifted");
  }
}
