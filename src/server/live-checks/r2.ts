import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { LiveCheckResult } from "./types.ts";

import { failedResult } from "./types.ts";

export interface StorageCheckDeps {
  clock: Clock;
  objects: ObjectStore;
}

export async function runStorageCheck(deps: StorageCheckDeps) {
  const startedAt = deps.clock.now();
  const key = `live-checks/${crypto.randomUUID()}.txt`;
  const payload = new TextEncoder().encode(`overture live check ${String(startedAt)}`);

  try {
    await deps.objects.put(key, payload);

    const stored = await deps.objects.get(key);

    if (stored === null) {
      return failedResult("r2", startedAt, "object was missing after put");
    }

    if (
      stored.byteLength !== payload.byteLength ||
      stored.some((byte, index) => byte !== payload[index])
    ) {
      return failedResult("r2", startedAt, "object bytes differed after get");
    }

    let listed = false;

    for await (const candidate of deps.objects.list(key)) {
      if (candidate === key) {
        listed = true;
      }
    }

    if (!listed) {
      return failedResult("r2", startedAt, "object was missing from the list");
    }

    await deps.objects.delete(key);

    const deleted = await deps.objects.get(key);

    if (deleted !== null) {
      return failedResult("r2", startedAt, "object was still present after delete");
    }

    return {
      check: "r2",
      ok: true,
      startedAt,
      durationMs: deps.clock.now() - startedAt,
      detail: { bytes: payload.byteLength, key, listed },
    } satisfies LiveCheckResult;
  } catch (error) {
    return failedResult(
      "r2",
      startedAt,
      error instanceof Error ? error.message : String(error),
      deps.clock.now() - startedAt,
    );
  }
}
