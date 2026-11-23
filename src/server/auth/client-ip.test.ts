import { describe, expect, test } from "bun:test";

import { clientIp, clientIpHeaders, isCloudflareIp, stripUntrustedIpHeaders } from "./client-ip.ts";

const fly = { flyAppName: "overture", nodeEnv: "production" as const };
const local = { flyAppName: undefined, nodeEnv: "test" as const };
const production = { flyAppName: undefined, nodeEnv: "production" as const };
const flyRequestId = "01J8Z0Y8Y0V8R4T7B0X2K6M3Q1";

function request(headers: Record<string, string>) {
  return new Request("http://app.test/api/auth/sign-in/email", { method: "POST", headers });
}

describe("clientIp on Fly", () => {
  test("uses fly-client-ip when Fly's proxy stamped the request", () => {
    const ip = clientIp(
      request({
        "fly-client-ip": "203.0.113.9",
        "fly-request-id": flyRequestId,
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
          "fly-request-id": flyRequestId,
        }),
        fly,
      ),
    ).toBeNull();
    expect(
      clientIp(request({ "fly-client-ip": "not-an-ip", "fly-request-id": flyRequestId }), fly),
    ).toBeNull();
  });
});

describe("clientIp behind Cloudflare in front of Fly", () => {
  test("a Cloudflare IPv4 edge IP prefers the visitor in cf-connecting-ip", () => {
    const ip = clientIp(
      request({
        "fly-client-ip": "172.71.1.1",
        "cf-connecting-ip": "203.0.113.9",
        "fly-request-id": flyRequestId,
      }),
      fly,
    );

    expect(ip).toBe("203.0.113.9");
  });

  test("a Cloudflare IPv6 edge IP prefers an IPv6 visitor in cf-connecting-ip", () => {
    const ip = clientIp(
      request({
        "fly-client-ip": "2606:4700::1",
        "cf-connecting-ip": "2001:db8::5",
        "fly-request-id": flyRequestId,
      }),
      fly,
    );

    expect(ip).toBe("2001:db8::5");
  });

  test("a Cloudflare edge without a usable cf-connecting-ip falls back to the edge IP", () => {
    expect(
      clientIp(request({ "fly-client-ip": "104.16.1.2", "fly-request-id": flyRequestId }), fly),
    ).toBe("104.16.1.2");
    expect(
      clientIp(
        request({
          "fly-client-ip": "104.16.1.2",
          "cf-connecting-ip": "not-an-ip",
          "fly-request-id": flyRequestId,
        }),
        fly,
      ),
    ).toBe("104.16.1.2");
  });

  test("a direct client behind a non-Cloudflare Fly IP cannot spoof cf-connecting-ip", () => {
    const ip = clientIp(
      request({
        "fly-client-ip": "198.51.100.7",
        "cf-connecting-ip": "1.2.3.4",
        "fly-request-id": flyRequestId,
      }),
      fly,
    );

    expect(ip).toBe("198.51.100.7");
  });

  test("a non-Cloudflare Fly IP drops a spoofed cf-connecting-ip before better-auth reads it", () => {
    const stripped = stripUntrustedIpHeaders(
      request({
        "fly-client-ip": "198.51.100.7",
        "cf-connecting-ip": "1.2.3.4",
        "fly-request-id": flyRequestId,
      }),
      fly,
    );

    expect(stripped.headers.get("fly-client-ip")).toBe("198.51.100.7");
    expect(stripped.headers.get("cf-connecting-ip")).toBeNull();
  });

  test("a Cloudflare edge keeps cf-connecting-ip for better-auth", () => {
    const stripped = stripUntrustedIpHeaders(
      request({
        "fly-client-ip": "172.71.1.1",
        "cf-connecting-ip": "203.0.113.9",
        "fly-request-id": flyRequestId,
      }),
      fly,
    );

    expect(stripped.headers.get("cf-connecting-ip")).toBe("203.0.113.9");
  });

  test("an unstamped request strips both Fly and Cloudflare IP headers", () => {
    const stripped = stripUntrustedIpHeaders(
      request({ "fly-client-ip": "172.71.1.1", "cf-connecting-ip": "203.0.113.9" }),
      fly,
    );

    expect(stripped.headers.get("fly-client-ip")).toBeNull();
    expect(stripped.headers.get("cf-connecting-ip")).toBeNull();
  });

  test("offers better-auth cf-connecting-ip first, then the proxy-stamped Fly header", () => {
    expect(clientIpHeaders(fly)).toEqual(["cf-connecting-ip", "fly-client-ip"]);
  });

  test("removes an unstamped fly-client-ip before the auth handler reads it", () => {
    const stamped = request({ "fly-client-ip": "203.0.113.9", "fly-request-id": "req-1" });
    const bare = request({ "fly-client-ip": "203.0.113.9" });

    expect(stripUntrustedIpHeaders(stamped, fly).headers.get("fly-client-ip")).toBe("203.0.113.9");
    expect(stripUntrustedIpHeaders(bare, fly).headers.get("fly-client-ip")).toBeNull();
  });
});

describe("isCloudflareIp", () => {
  test("matches the published IPv4 ranges and their edges", () => {
    expect(isCloudflareIp("173.245.48.1")).toBe(true);
    expect(isCloudflareIp("104.16.0.1")).toBe(true);
    expect(isCloudflareIp("104.23.255.255")).toBe(true);
    expect(isCloudflareIp("104.24.0.1")).toBe(true);
    expect(isCloudflareIp("172.64.0.1")).toBe(true);
    expect(isCloudflareIp("172.71.255.255")).toBe(true);
    expect(isCloudflareIp("131.0.72.99")).toBe(true);
    expect(isCloudflareIp("162.158.0.1")).toBe(true);
    expect(isCloudflareIp("198.41.128.1")).toBe(true);
  });

  test("rejects IPv4 addresses just outside the published ranges", () => {
    expect(isCloudflareIp("104.15.255.255")).toBe(false);
    expect(isCloudflareIp("104.28.0.1")).toBe(false);
    expect(isCloudflareIp("172.72.0.1")).toBe(false);
    expect(isCloudflareIp("131.0.76.1")).toBe(false);
    expect(isCloudflareIp("173.245.32.1")).toBe(false);
    expect(isCloudflareIp("203.0.113.9")).toBe(false);
  });

  test("matches the published IPv6 ranges and their edges", () => {
    expect(isCloudflareIp("2400:cb00::1")).toBe(true);
    expect(isCloudflareIp("2606:4700::1")).toBe(true);
    expect(isCloudflareIp("2803:f800::1")).toBe(true);
    expect(isCloudflareIp("2a06:98c0::1")).toBe(true);
    expect(isCloudflareIp("2c0f:f248::1")).toBe(true);
    expect(isCloudflareIp("2c0f:f248:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
  });

  test("rejects IPv6 addresses just outside the published ranges", () => {
    expect(isCloudflareIp("2c0f:f249::1")).toBe(false);
    expect(isCloudflareIp("2606:4701::1")).toBe(false);
    expect(isCloudflareIp("2001:db8::1")).toBe(false);
  });

  test("treats an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(isCloudflareIp("::ffff:104.16.0.1")).toBe(true);
    expect(isCloudflareIp("::ffff:203.0.113.9")).toBe(false);
  });

  test("rejects a value that is not an IP address", () => {
    expect(isCloudflareIp("not-an-ip")).toBe(false);
    expect(isCloudflareIp("")).toBe(false);
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

  test("strips Fly, Cloudflare and forwarded headers before the auth handler on a production host", () => {
    const stripped = stripUntrustedIpHeaders(
      request({
        "x-forwarded-for": "198.51.100.7",
        "fly-client-ip": "203.0.113.9",
        "cf-connecting-ip": "203.0.113.10",
      }),
      production,
    );

    expect(stripped.headers.get("x-forwarded-for")).toBeNull();
    expect(stripped.headers.get("fly-client-ip")).toBeNull();
    expect(stripped.headers.get("cf-connecting-ip")).toBeNull();
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
