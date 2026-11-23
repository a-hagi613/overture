import { describe, expect, test } from "bun:test";

import { trustedOriginsFor } from "./trusted-origins.ts";

describe("trustedOriginsFor", () => {
  test("includes the app origin, the admin origin and the local host patterns", () => {
    expect(
      trustedOriginsFor({
        appOrigin: "https://tryoverture.com",
        adminOrigin: "https://admin.tryoverture.com",
        allowedHosts: ["localhost", "127.0.0.1"],
      }),
    ).toEqual([
      "https://tryoverture.com",
      "https://admin.tryoverture.com",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ]);
  });

  test("trusts the admin origin on its own", () => {
    expect(
      trustedOriginsFor({
        appOrigin: undefined,
        adminOrigin: "https://admin.tryoverture.com",
        allowedHosts: undefined,
      }),
    ).toEqual(["https://admin.tryoverture.com"]);
  });

  test("deduplicates an admin origin that is also the app origin", () => {
    expect(
      trustedOriginsFor({
        appOrigin: "http://localhost:3000",
        adminOrigin: "http://localhost:3000",
        allowedHosts: ["localhost"],
      }),
    ).toEqual(["http://localhost:3000", "http://localhost:*"]);
  });

  test("returns nothing when no origin is configured", () => {
    expect(
      trustedOriginsFor({ appOrigin: undefined, adminOrigin: undefined, allowedHosts: undefined }),
    ).toEqual([]);
  });
});
