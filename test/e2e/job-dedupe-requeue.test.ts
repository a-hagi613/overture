import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import type { SseEvent } from "./sse.ts";

import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

const createdSchema = z.object({ id: z.string() });
const startedSchema = z.object({ id: z.string() });

const DEDUPE_KEY = "dedupe-requeue";

function isStartedFor(id: string) {
  return (event: SseEvent) => {
    if (event.event !== "job.started") {
      return false;
    }

    return startedSchema.parse(JSON.parse(event.data)).id === id;
  };
}

async function enqueue(url: string) {
  const response = await fetch(`${url}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "test.blocking", payload: "{}", dedupeKey: DEDUPE_KEY }),
  });

  expect(response.ok).toBe(true);

  return createdSchema.parse(await response.json()).id;
}

test("requeueing a job whose key has a queued row leaves one queued row and no running one", async ({
  isolatedAppServer,
}) => {
  const { databasePath, url } = isolatedAppServer;

  const firstId = await enqueue(url);

  expect(await readSseEventUntil(`${url}/api/events`, null, isStartedFor(firstId))).not.toBeNull();

  await enqueue(url);

  await isolatedAppServer.stop();

  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA busy_timeout = 5000;");

  try {
    const rows = z
      .array(z.object({ id: z.string(), status: z.string() }))
      .parse(
        database.prepare("SELECT id, status FROM bg_jobs WHERE dedupe_key = ?").all(DEDUPE_KEY),
      );

    expect(rows.some((row) => row.status === "running")).toBe(false);
    expect(rows.filter((row) => row.status === "queued")).toHaveLength(1);
  } finally {
    database.close();
  }
});
