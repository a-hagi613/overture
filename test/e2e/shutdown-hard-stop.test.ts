import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { ownerSseSession } from "./sse-auth.ts";

test("an open event stream and a telemetry flush that never settles cannot hold the server past the kill timeout", async ({
  identityServer,
}) => {
  const stalled = Promise.withResolvers<Response>();

  const collector = Bun.serve({
    fetch: async () => stalled.promise,
    port: 0,
  });

  const server = await startFreshAppServer(identityServer, {
    KILL_TIMEOUT_MS: "300",
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${String(collector.port)}`,
  });

  const session = await ownerSseSession(server.url);

  try {
    const events = await fetch(`${server.url}/api/events`, {
      headers: { cookie: session.cookie },
    });

    expect(events.status).toBe(200);

    const started = performance.now();

    await server.stop();

    expect(performance.now() - started).toBeLessThan(5000);
  } finally {
    await session.dispose();
    await collector.stop(true);
  }
});

test("an open event stream does not hold shutdown past the drain budget", async ({
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, { KILL_TIMEOUT_MS: "3000" });
  const session = await ownerSseSession(server.url);

  try {
    const events = await fetch(`${server.url}/api/events`, {
      headers: { cookie: session.cookie },
    });

    expect(events.status).toBe(200);

    const started = performance.now();

    await server.stop();

    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(5000);

    expect(await server.waitForStderr(/shutdown: stopped in \d+ ms/u)).toContain("shutdown");
  } finally {
    await session.dispose();
    await server.stop();
  }
});
