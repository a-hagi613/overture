import { Database } from "bun:sqlite";
import { z } from "zod";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { ownerSseSession } from "./sse-auth.ts";

const enqueuedSchema = z.object({ id: z.string().min(1) });
const jobRowSchema = z.object({ status: z.string(), attempts: z.number() });
const ledgerRowSchema = z.object({ amount: z.number(), kind: z.string() });

const JOB_DELAY_MS = 1500;
const JOB_QUANTITY = 7;

test("SIGTERM drains an active long job and commits its ledger grant before exiting", async ({
  identityServer,
}) => {
  test.setTimeout(60_000);

  const server = await startFreshAppServer(identityServer, { KILL_TIMEOUT_MS: "6000" });
  const session = await ownerSseSession(server.url);

  try {
    const enqueued = await fetch(`${server.url}/__test__/jobs/enqueue`, {
      body: JSON.stringify({
        kind: "test.slow-ledger",
        payload: JSON.stringify({
          delayMs: JOB_DELAY_MS,
          quantity: JOB_QUANTITY,
          userId: session.userId,
        }),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(enqueued.ok).toBe(true);

    const { id } = enqueuedSchema.parse(await enqueued.json());

    await expect
      .poll(
        async () => {
          const response = await fetch(`${server.url}/__test__/jobs/${id}`);

          return response.ok ? jobRowSchema.parse(await response.json()).status : "missing";
        },
        { timeout: 15_000 },
      )
      .toBe("running");

    await server.stop();

    expect(await server.waitForStderr(/SIGTERM: draining with a \d+ ms budget/u)).toContain(
      "SIGTERM",
    );

    const database = new Database(server.databasePath, { readonly: true });

    try {
      database.run("PRAGMA busy_timeout = 5000;");

      const job = jobRowSchema.parse(
        database.query("select status, attempts from bg_jobs where id = ?").get(id),
      );

      const grant = ledgerRowSchema.parse(
        database
          .query("select kind, amount from ledger where idempotency_key = ?")
          .get(`test-slow-ledger:${session.userId}`),
      );

      expect(job.status).toBe("done");
      expect(grant).toEqual({ amount: JOB_QUANTITY, kind: "grant" });
    } finally {
      database.close();
    }
  } finally {
    await session.dispose();
    await server.stop();
  }
});
