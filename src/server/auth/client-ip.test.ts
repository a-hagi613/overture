import { describe, expect, test } from "bun:test";

import { clientIp, clientIpHeaders, stripUntrustedIpHeaders } from "./client-ip.ts";

const fly = { flyAppName: "overture", nodeEnv: "production" as const };
const local = { flyAppName: undefined, nodeEnv: "test" as const };
const production = { flyAppName: undefined, nodeEnv: "production" as const };

function request(headers: Record<string, string>) {
  return new Request("http://app.test/api/auth/sign-in/email", { method: "POST", headers });
}

describe("clientIp on Fly", () => {
  test("uses fly-client-ip when Fly's proxy stamped the request", () => {
    const ip = clientIp(
      request({
        "fly-client-ip": "203.0.113.9",
        "fly-request-id": "01J8Z0Y8Y0V8R4T7B0X2K6M3Q1",
        "x-forwarded-for": "198.51.100.7",
      }),
      fly,
    );

    expect(ip).toBe("203.0.113.9");
  });

  test("ignores a forwarded chain and a fly-client-ip the proxy did not stamp", () => {
    expect(
      clientIp(request({ "x-forwarded-for": "198.51.100.7", "fly-client-ip": "203.0.113.9" }), fly),
    ).toBeNull();
  });

  test("a blank or whitespace request id is not a stamp", () => {
    expect(
      clientIp(request({ "fly-client-ip": "203.0.113.9", "fly-request-id": "" }), fly),
    ).toBeNull();
    expect(
      clientIp(request({ "fly-client-ip": "203.0.113.9", "fly-request-id": "   " }), fly),
    ).toBeNull();
  });

  test("a header that is not one address is not an IP", () => {
    expect(
      clientIp(
        request({
          "fly-client-ip": "203.0.113.9, 198.51.100.7",
          "fly-request-id": "01J8Z0Y8Y0V8R4T7B0X2K6M3Q1",
        }),
        fly,
      ),
    ).toBeNull();
    expect(
      clientIp(
        request({ "fly-client-ip": "not-an-ip", "fly-request-id": "01J8Z0Y8Y0V8R4T7B0X2K6M3Q1" }),
        fly,
      ),
    ).toBeNull();
  });

  test("offers better-auth only the proxy-stamped header", () => {
    expect(clientIpHeaders(fly)).toEqual(["fly-client-ip"]);
  });

  test("removes an unstamped fly-client-ip before the auth handler reads it", () => {
    const stamped = request({ "fly-client-ip": "203.0.113.9", "fly-request-id": "req-1" });
    const bare = request({ "fly-client-ip": "203.0.113.9" });

    expect(stripUntrustedIpHeaders(stamped, fly).headers.get("fly-client-ip")).toBe("203.0.113.9");
    expect(stripUntrustedIpHeaders(bare, fly).headers.get("fly-client-ip")).toBeNull();
  });
});

describe("clientIp off Fly", () => {
  test("a production host never trusts a client-set forwarded header", () => {
    const ip = clientIp(
      request({ "x-forwarded-for": "198.51.100.7", "fly-client-ip": "203.0.113.9" }),
      production,
    );

    expect(ip).toBeNull();
    expect(clientIpHeaders(production)).toEqual([]);
  });

  test("strips both headers before the auth handler on a production host", () => {
    const stripped = stripUntrustedIpHeaders(
      request({ "x-forwarded-for": "198.51.100.7", "fly-client-ip": "203.0.113.9" }),
      production,
    );

    expect(stripped.headers.get("x-forwarded-for")).toBeNull();
    expect(stripped.headers.get("fly-client-ip")).toBeNull();
  });

  test("local development and tests keep the forwarded header they run behind", () => {
    expect(clientIp(request({ "x-forwarded-for": "198.51.100.7" }), local)).toBe("198.51.100.7");
    expect(
      stripUntrustedIpHeaders(request({ "x-forwarded-for": "198.51.100.7" }), local).headers.get(
        "x-forwarded-for",
      ),
    ).toBe("198.51.100.7");
  });

  test("an empty, missing or malformed header resolves to no IP", () => {
    expect(clientIp(request({}), local)).toBeNull();
    expect(clientIp(request({ "x-forwarded-for": "  " }), local)).toBeNull();
    expect(clientIp(request({ "x-forwarded-for": "not-an-ip" }), local)).toBeNull();
  });
});
