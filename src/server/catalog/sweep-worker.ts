import { databasePath, env } from "../config/env.ts";
import { openDatabase } from "../platform/db/client.ts";
import { createClock } from "../platform/ports/clock.ts";
import { installOutboundGuard } from "../platform/outbound-guard.ts";
import { createAshbyFeed } from "./ashby-feed.ts";
import { createGreenhouseFeed } from "./greenhouse-feed.ts";
import { createLeverFeed } from "./lever-feed.ts";
import { pollDueBoards, runBackfillPass, summarizeRun } from "./sweep-run.ts";
import { sweepRunRequestSchema } from "./sweep-worker-protocol.ts";

import type { BoardFeeds } from "./board-feed.ts";
import type { SweepWorkerResponse } from "./sweep-worker-protocol.ts";

const { db } = openDatabase(databasePath);

if (env.NODE_ENV !== "production") {
  installOutboundGuard(env.NODE_ENV);
}

const clock = createClock();

const feeds: BoardFeeds = {
  greenhouse: createGreenhouseFeed(env.GREENHOUSE_FEED_BASE_URL),
  lever: createLeverFeed(env.LEVER_FEED_BASE_URL, undefined, env.LEVER_EU_FEED_BASE_URL),
  ashby: createAshbyFeed(env.ASHBY_FEED_BASE_URL),
};

function send(message: SweepWorkerResponse) {
  postMessage(message, []);
}

async function run(kind: "sweep" | "backfill") {
  const started = performance.now();

  const reports =
    kind === "backfill"
      ? await runBackfillPass(db, clock, feeds)
      : await pollDueBoards(db, clock, feeds);

  return summarizeRun(kind, reports, performance.now() - started);
}

globalThis.addEventListener("message", (event: MessageEvent) => {
  void (async () => {
    const parsed = sweepRunRequestSchema.safeParse(event.data);

    if (!parsed.success) {
      return;
    }

    const { id, kind, offsetMs } = parsed.data;

    clock.setOffset(offsetMs);

    try {
      const summary = await run(kind);

      send({ type: "done", id, summary });
    } catch (error) {
      send({ type: "failed", id, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

send({ type: "ready" });
