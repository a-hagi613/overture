import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { expect, test } from "./app.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { ownerContextFor } from "./matching-harness.ts";

const okSchema = z.object({ ok: z.boolean() });

test("a write lock held past busy_timeout does not turn the paused-Home seed into a 500", async ({
  isolatedAppServer: { url, databasePath, waitForStderr },
}) => {
  const { owner } = await ownerContextFor(url);
  const lock = new DatabaseSync(databasePath);
  let holding = true;

  function release() {
    if (!holding) {
      return;
    }

    holding = false;

    try {
      lock.exec("COMMIT");
    } catch {}

    lock.close();
  }

  try {
    lock.exec("PRAGMA busy_timeout = 0");
    lock.exec("BEGIN IMMEDIATE");

    const busyLogged = waitForStderr(
      /test\.home-sample\.grant: attempt 1 hit .*database is locked; retrying/u,
    );

    const seed = fetch(`${url}/__test__/home/sample`, {
      body: JSON.stringify({ email: authTestIdentity.ownerEmail, variant: "paused" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(await busyLogged).toContain("database is locked");

    release();

    const response = await seed;

    expect(response.status).toBe(200);
    expect(okSchema.parse(await response.json())).toEqual({ ok: true });
  } finally {
    release();
    await owner.dispose();
  }
});
