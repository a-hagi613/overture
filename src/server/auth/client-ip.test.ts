import { describe, expect, test } from "bun:test";

import { clientIp, clientIpHeaders } from "./client-ip.ts";

const fly = { flyAppName: "overture", nodeEnv: "production" as const };
const local = { flyAppName: undefined, nodeEnv: "test" as const };

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

  test("offers better-auth only the proxy-stamped header", () => {
    expect(clientIpHeaders(fly)).toEqual(["fly-client-ip"]);
  });
});

describe("clientIp off Fly", () => {
  test("a production host never trusts a client-set forwarded header", () => {
    const ip = clientIp(
      request({ "x-forwarded-for": "198.51.100.7", "fly-client-ip": "203.0.113.9" }),
      { flyAppName: undefined, nodeEnv: "production" },
    );

    expect(ip).toBeNull();
    expect(clientIpHeaders({ flyAppName: undefined, nodeEnv: "production" })).toEqual([
      "x-forwarded-for",
    ]);
  });

  test("local development and tests keep the forwarded header they run behind", () => {
    expect(clientIp(request({ "x-forwarded-for": "198.51.100.7" }), local)).toBe("198.51.100.7");
  });

  test("an empty or missing header resolves to no IP", () => {
    expect(clientIp(request({}), local)).toBeNull();
    expect(clientIp(request({ "x-forwarded-for": "  " }), local)).toBeNull();
  });
});
