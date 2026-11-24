import { afterAll, expect, test } from "bun:test";

import { resolveZoneId } from "./sending-domain.ts";

const requestedZones: string[] = [];

const api = Bun.serve({
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "";

    requestedZones.push(name);

    if (name === "tryoverture.com") {
      return Response.json({
        errors: [],
        result: [{ id: "zone-tryoverture", name: "tryoverture.com" }],
        success: true,
      });
    }

    return Response.json({ errors: [], result: [], success: true });
  },
});

afterAll(() => {
  void api.stop(true);
});

function config(domain: string, zoneId: string | null = null) {
  return {
    accountId: null,
    apiToken: "token-1",
    baseUrl: `http://127.0.0.1:${String(api.port)}`,
    domain,
    zoneId,
  };
}

test("a notify subdomain resolves the zone that owns its parent", async () => {
  requestedZones.length = 0;

  expect(await resolveZoneId(config("notify.tryoverture.com"))).toBe("zone-tryoverture");
  expect(requestedZones).toEqual(["notify.tryoverture.com", "tryoverture.com"]);
});

test("an explicit zone id answers without a request", async () => {
  requestedZones.length = 0;

  expect(await resolveZoneId(config("notify.tryoverture.com", "zone-explicit"))).toBe(
    "zone-explicit",
  );
  expect(requestedZones).toEqual([]);
});

test("a domain with no owning zone fails with a clear message", async () => {
  let message = "";

  try {
    await resolveZoneId(config("notify.example.test"));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toContain("no zone for notify.example.test");
});
