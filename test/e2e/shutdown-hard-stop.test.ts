import { expect, startFreshAppServer, test } from "./app.fixture.ts";

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

  try {
    const events = await fetch(`${server.url}/api/events`);

    expect(events.status).toBe(200);

    const started = performance.now();

    await server.stop();

    expect(performance.now() - started).toBeLessThan(5000);
  } finally {
    await collector.stop(true);
  }
});
