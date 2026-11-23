import { describe, expect, test } from "bun:test";

import { CROSS_SITE_CODE, crossSiteRefusal } from "./csrf.ts";

const APP_ORIGIN = "https://tryoverture.com";

function write(headers: Record<string, string>, url = `${APP_ORIGIN}/api/profile/facts`) {
  return new Request(url, { body: "{}", headers, method: "POST" });
}

describe("the cross-site write guard", () => {
  test("permits a write with no browser origin headers, as a server-to-server call sends none", () => {
    expect(crossSiteRefusal(write({}), [APP_ORIGIN])).toBeNull();
  });

  test("permits a same-origin browser write", () => {
    const request = write({
      origin: APP_ORIGIN,
      "sec-fetch-site": "same-origin",
    });

    expect(crossSiteRefusal(request, [APP_ORIGIN])).toBeNull();
  });

  test("permits the configured app origin behind a proxy whose request URL differs", () => {
    const request = write({ origin: APP_ORIGIN }, "http://10.0.0.4:3000/api/profile/facts");

    expect(crossSiteRefusal(request, [APP_ORIGIN])).toBeNull();
  });

  test("refuses a write the browser marks cross-site", () => {
    const refusal = crossSiteRefusal(
      write({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
      [APP_ORIGIN],
    );

    expect(refusal?.status).toBe(403);
  });

  test("refuses a write whose origin is neither allowed nor the request's own origin", async () => {
    const refusal = crossSiteRefusal(write({ origin: "https://evil.example" }), [APP_ORIGIN]);

    expect(refusal?.status).toBe(403);
    expect(await refusal?.json()).toEqual({ error: CROSS_SITE_CODE });
  });

  test("permits the request's own origin when no app origin is configured", () => {
    const request = write({ origin: "http://127.0.0.1:4173" }, "http://127.0.0.1:4173/api/home");

    expect(crossSiteRefusal(request, [])).toBeNull();
  });

  test("never blocks a read", () => {
    const request = new Request(`${APP_ORIGIN}/api/home`, {
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });

    expect(crossSiteRefusal(request, [APP_ORIGIN])).toBeNull();
  });
});
