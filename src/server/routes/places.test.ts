import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { placeSuggestionsResponseSchema } from "../../shared/places.ts";
import { createPlaceRoutes } from "./places.ts";

const handles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }
});

function createTestApp() {
  const app = openDatabase(":memory:");

  handles.push(app.sqlite);
  migrateDatabase(app.db, "drizzle");

  const routes = new Hono();

  routes.route(
    "/api",
    createPlaceRoutes({
      clientIpConfig: { flyAppName: undefined, nodeEnv: "test" },
      clock: createClock(),
      db: app.db,
    }),
  );

  return routes;
}

async function request(app: Hono, path: string) {
  return app.request(path, { headers: { "x-forwarded-for": "203.0.113.9" } });
}

describe("the public place picker endpoint", () => {
  test("returns canonical ids with the region and country of a city", async () => {
    const response = await request(createTestApp(), "/api/places/suggest?q=toronto");

    expect(response.status).toBe(200);

    const body = placeSuggestionsResponseSchema.parse(await response.json());
    const toronto = body.suggestions.find((place) => place.id === "city:ca:toronto");

    expect(toronto).toEqual({
      id: "city:ca:toronto",
      kind: "city",
      label: "Toronto",
      meta: "Ontario, Canada",
    });
  });

  test("offers a remote scope beside the physical country", async () => {
    const response = await request(createTestApp(), "/api/places/suggest?q=canada");
    const body = placeSuggestionsResponseSchema.parse(await response.json());
    const ids = body.suggestions.map((place) => place.id);

    expect(ids).toContain("country:ca");
    expect(ids).toContain("remote:country:ca");
  });

  test("an empty query offers worldwide and the common hubs", async () => {
    const response = await request(createTestApp(), "/api/places/suggest");
    const body = placeSuggestionsResponseSchema.parse(await response.json());
    const ids = body.suggestions.map((place) => place.id);

    expect(ids).toContain("remote:worldwide");
    expect(ids).toContain("country:ca");
  });
});
