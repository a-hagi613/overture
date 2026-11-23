import { describe, expect, test } from "bun:test";

import type {
  CheckDependencies,
  CheckOptions,
  ProbeRequest,
  ProbeResponse,
  ResolvedAddress,
} from "./check-production.ts";

import {
  allChecksPassed,
  classifyAdminHttps,
  classifyAnonymousMe,
  describeAddresses,
  exitCodeFor,
  humanReport,
  isAccessRedirect,
  jsonReport,
  missingPricingCopy,
  parseArguments,
  runChecks,
} from "./check-production.ts";

const options: CheckOptions = {
  adminOrigin: "https://admin.tryoverture.com",
  json: false,
  origin: "https://tryoverture.com",
};

function response(status: number, bodyText = "", headers: Record<string, string> = {}) {
  return { bodyText, headers, status } satisfies ProbeResponse;
}

function outcomeOf(probeResponse: ProbeResponse | null, failure = "") {
  return { failure, ms: 3, response: probeResponse };
}

function htmlHeaders() {
  return { "content-type": "text/html; charset=utf-8" };
}

const landingHtml = [
  "<h2>Pay only for applications <em>sent.</em></h2>",
  "<h3>Weekly</h3><span>$9.99</span>",
  "<h3>Monthly</h3><span>$29.99</span>",
].join("");

const landingHeaders = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=15552000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

type StubTable = Record<string, (request: ProbeRequest) => ProbeResponse>;

function stubDependencies(table: StubTable, addresses: ResolvedAddress[] = []) {
  const requested: string[] = [];

  const dependencies: CheckDependencies = {
    fetchPage: async (url, request) => {
      await Promise.resolve();
      requested.push(`${request.method} ${url}`);

      const key = `${request.method} ${new URL(url).pathname}`;
      const handler = table[key];

      if (handler === undefined) {
        throw new Error(`unexpected request ${key}`);
      }

      return handler(request);
    },
    resolveHost: async () => {
      await Promise.resolve();

      return addresses;
    },
  };

  return { dependencies, requested };
}

function healthyTable() {
  return {
    "GET /": () => response(200, landingHtml, { ...htmlHeaders(), ...landingHeaders }),
    "GET /api/health": () =>
      response(
        200,
        JSON.stringify({
          backups: { replication: "ok" },
          database: "ok",
          status: "ok",
        }),
        { "content-type": "application/json" },
      ),
    "GET /signin": () => response(200, "<!doctype html>", htmlHeaders()),
    "GET /sw.js": () =>
      response(200, "self.addEventListener('install', () => {});", {
        "cache-control": "no-cache",
        "content-type": "text/javascript",
      }),
    "GET /assets/definitely-missing-wave5-check.js": () =>
      response(404, "not found", { "content-type": "text/plain" }),
    "GET /settings/billing": () => response(200, "<!doctype html>", htmlHeaders()),
    "GET /pricing": () => response(200, "<!doctype html>", htmlHeaders()),
    "GET /search": () => response(200, "<!doctype html>", htmlHeaders()),
    "GET /inbox/address": () => response(200, "<!doctype html>", htmlHeaders()),
    "POST /webhooks/stripe": () => response(400, '{"error":"invalid_signature"}'),
    "GET /api/events": () => response(401, '{"error":"sign_in_required"}'),
    "GET /api/me": () => response(200, '{"user":null,"adminOrigin":null}'),
    "POST /api/billing/checkout": () => response(401, '{"error":"sign_in_required"}'),
    "GET /admin/api/session": () => response(401, '{"error":"access_required"}'),
  } satisfies StubTable;
}

describe("check-production arguments", () => {
  test("defaults to the production origin and admin host", () => {
    expect(parseArguments([])).toEqual({
      kind: "options",
      options: {
        adminOrigin: "https://admin.tryoverture.com",
        json: false,
        origin: "https://tryoverture.com",
      },
    });
  });

  test("reads --origin, --admin-origin and --json", () => {
    expect(
      parseArguments([
        "--origin",
        "https://staging.example.test/ignored",
        "--admin-origin",
        "https://admin.example.test",
        "--json",
      ]),
    ).toEqual({
      kind: "options",
      options: {
        adminOrigin: "https://admin.example.test",
        json: true,
        origin: "https://staging.example.test",
      },
    });
  });

  test("refuses a value-less flag, an unknown flag and a non-URL origin", () => {
    for (const args of [["--origin"], ["--admin-origin"], ["--wat"], ["--origin", "nope"]]) {
      expect(parseArguments(args).kind).toBe("error");
    }
  });

  test("refuses plain http for both origins", () => {
    expect(parseArguments(["--origin", "http://tryoverture.com"])).toEqual({
      kind: "error",
      message: "--origin must be an https URL: http://tryoverture.com",
    });
    expect(parseArguments(["--admin-origin", "http://admin.tryoverture.com"]).kind).toBe("error");
  });

  test("asks for help without probing", () => {
    expect(parseArguments(["--help"])).toEqual({ kind: "help" });
  });
});

describe("check-production content", () => {
  test("names every approved pricing string that is missing", () => {
    expect(missingPricingCopy(landingHtml)).toEqual([]);
    expect(missingPricingCopy("<h2>Pay only for applications</h2>")).toEqual(["$9.99", "$29.99"]);
    expect(missingPricingCopy("")).toEqual(["Pay only for applications", "$9.99", "$29.99"]);
  });

  test("only an https Cloudflare Access host is a sign-in redirect", () => {
    expect(isAccessRedirect("https://overture.cloudflareaccess.com/cdn-cgi/access/login")).toBe(
      true,
    );

    for (const location of [
      null,
      "https://cloudflareaccess.com.evil.example/login",
      "http://overture.cloudflareaccess.com/login",
      "not a url",
    ]) {
      expect(isAccessRedirect(location), String(location)).toBe(false);
    }
  });

  test("renders resolved addresses and notes an empty answer", () => {
    expect(
      describeAddresses([
        { address: "203.0.113.10", family: 4 },
        { address: "2001:db8::1", family: 6 },
      ]),
    ).toBe("resolves to 203.0.113.10 (IPv4), 2001:db8::1 (IPv6)");
    expect(describeAddresses([])).toBe("the resolver returned no address");
  });
});

describe("check-production anonymous /api/me", () => {
  test("a 401 or the anonymous 200 both prove the guard ran", () => {
    expect(classifyAnonymousMe(outcomeOf(response(401, "{}"))).status).toBe("pass");
    expect(classifyAnonymousMe(outcomeOf(response(200, '{"user":null}'))).status).toBe("pass");
  });

  test("a user object without a session, a non-JSON body or another status fails", () => {
    expect(classifyAnonymousMe(outcomeOf(response(200, '{"user":{"id":"u1"}}'))).status).toBe(
      "fail",
    );
    expect(classifyAnonymousMe(outcomeOf(response(200, "<html>"))).status).toBe("fail");
    expect(classifyAnonymousMe(outcomeOf(response(500, "{}"))).status).toBe("fail");
    expect(classifyAnonymousMe(outcomeOf(null, "getaddrinfo ENOTFOUND")).status).toBe("fail");
  });
});

describe("check-production admin host", () => {
  test("401, 403 and a Cloudflare Access redirect pass", () => {
    expect(classifyAdminHttps(outcomeOf(response(401, ""))).status).toBe("pass");
    expect(classifyAdminHttps(outcomeOf(response(403, ""))).status).toBe("pass");
    expect(
      classifyAdminHttps(
        outcomeOf(
          response(302, "", {
            location: "https://overture.cloudflareaccess.com/cdn-cgi/access/login",
          }),
        ),
      ).status,
    ).toBe("pass");
  });

  test("200 without Access, a foreign redirect and a failure do not pass", () => {
    expect(
      classifyAdminHttps(outcomeOf(response(200, "<!doctype html>", htmlHeaders()))).status,
    ).toBe("fail");
    expect(
      classifyAdminHttps(outcomeOf(response(302, "", { location: "https://example.test/" })))
        .status,
    ).toBe("fail");
    expect(classifyAdminHttps(outcomeOf(null, "ECONNREFUSED")).status).toBe("fail");
  });
});

describe("check-production run", () => {
  test("a healthy production passes every check", async () => {
    const { dependencies } = stubDependencies(healthyTable(), [
      { address: "203.0.113.1", family: 4 },
    ]);

    const results = await runChecks(options, dependencies);

    expect(results.map((check) => check.name)).toEqual([
      "landing",
      "health",
      "signin",
      "headers.content-security-policy",
      "headers.content-type-options",
      "headers.referrer-policy",
      "headers.frame-options",
      "headers.hsts",
      "sw.cache",
      "assets.404",
      "api.stripe-webhook",
      "api.events",
      "api.me",
      "api.billing-checkout",
      "nav.settings.billing",
      "nav.pricing",
      "nav.search",
      "nav.inbox.address",
      "admin.dns",
      "admin.https",
    ]);
    expect(results.filter((check) => check.status !== "pass")).toEqual([]);
    expect(results.every((check) => check.ms >= 0)).toBe(true);
  });

  test("regressions fail instead of passing quietly", async () => {
    const table = {
      ...healthyTable(),
      "GET /": () => response(200, "<h2>Pay only for applications</h2>", landingHeaders),
      "GET /sw.js": () => response(200, "self.addEventListener('install', () => {});", {}),
      "GET /assets/definitely-missing-wave5-check.js": () =>
        response(200, "<!doctype html>", htmlHeaders()),
      "POST /webhooks/stripe": () => response(404, '{"error":"not_found"}'),
      "GET /api/events": () => response(200, "event: ping\n\n"),
      "GET /api/me": () => response(200, '{"user":{"id":"u1"}}'),
      "POST /api/billing/checkout": () => response(400, '{"error":"invalid_request"}'),
      "GET /pricing": () => response(404, "not found", { "content-type": "text/plain" }),
      "GET /admin/api/session": () => response(200, "<!doctype html>", htmlHeaders()),
    } satisfies StubTable;

    const { dependencies } = stubDependencies(table, [{ address: "203.0.113.1", family: 4 }]);
    const results = await runChecks(options, dependencies);
    const byName = new Map(results.map((check) => [check.name, check]));
    const assets = byName.get("assets.404");

    expect(byName.get("landing")?.status).toBe("fail");
    expect(byName.get("sw.cache")?.status).toBe("fail");
    expect(byName.get("sw.cache")?.detail).toContain("no-cache");
    expect(assets?.status).toBe("skip");
    expect(assets?.detail).toContain("SPA fallback");
    expect(assets?.ms).toBeGreaterThanOrEqual(0);
    expect(byName.get("api.stripe-webhook")?.detail).toContain("Wave 4 bug");
    expect(byName.get("api.events")?.status).toBe("fail");
    expect(byName.get("api.me")?.status).toBe("fail");
    expect(byName.get("api.billing-checkout")?.status).toBe("fail");
    expect(byName.get("nav.pricing")?.status).toBe("fail");
    expect(byName.get("admin.https")?.status).toBe("fail");
    expect(allChecksPassed(results)).toBe(false);
    expect(exitCodeFor(results)).toBe(1);
  });

  test("a missing asset that answers 404 passes", async () => {
    const table = {
      ...healthyTable(),
      "GET /assets/definitely-missing-wave5-check.js": () =>
        response(404, "not found", { "content-type": "text/plain" }),
    } satisfies StubTable;

    const { dependencies } = stubDependencies(table, [{ address: "203.0.113.1", family: 4 }]);
    const results = await runChecks(options, dependencies);

    expect(results.find((check) => check.name === "assets.404")?.status).toBe("pass");
  });

  test("an unresolvable admin host skips both admin checks with the next step", async () => {
    const { dependencies, requested } = stubDependencies(healthyTable(), []);
    const results = await runChecks(options, dependencies);
    const adminDns = results.find((check) => check.name === "admin.dns");
    const adminHttps = results.find((check) => check.name === "admin.https");

    expect(adminDns?.status).toBe("skip");
    expect(adminDns?.detail).toContain("flyctl certs add admin.tryoverture.com");
    expect(adminHttps?.status).toBe("skip");
    expect(requested).not.toContain("GET https://admin.tryoverture.com/admin/api/session");
    expect(allChecksPassed(results)).toBe(true);
  });

  test("security headers are checked one by one", async () => {
    const table = {
      ...healthyTable(),
      "GET /": () => response(200, landingHtml, htmlHeaders()),
    } satisfies StubTable;

    const { dependencies } = stubDependencies(table, [{ address: "203.0.113.1", family: 4 }]);
    const results = await runChecks(options, dependencies);
    const headerResults = results.filter((check) => check.name.startsWith("headers."));

    expect(headerResults).toHaveLength(5);
    expect(headerResults.every((check) => check.status === "fail")).toBe(true);
  });
});

describe("check-production report", () => {
  const passing = [
    { detail: "ok", ms: 12, name: "landing", status: "pass" },
    { detail: "skipped", ms: 0, name: "admin.https", status: "skip" },
  ] as const;

  test("every check passing or skipped exits 0", () => {
    expect(allChecksPassed(passing)).toBe(true);
    expect(exitCodeFor(passing)).toBe(0);
  });

  test("one failing check exits 1", () => {
    const failing = [...passing, { detail: "bad", ms: 1, name: "health", status: "fail" } as const];

    expect(exitCodeFor(failing)).toBe(1);
  });

  test("the human report prints a line per check with status, time and counts", () => {
    const report = humanReport(options, passing);

    expect(report).toContain("landing");
    expect(report).toContain("PASS");
    expect(report).toContain("SKIP");
    expect(report).toContain("12 ms");
    expect(report).toContain("1 passed, 0 failed, 1 skipped");
  });

  test("the JSON report carries the checks, counts and origins", () => {
    const parsed: unknown = JSON.parse(jsonReport(options, passing));

    expect(parsed).toEqual({
      adminOrigin: "https://admin.tryoverture.com",
      checks: passing,
      counts: { fail: 0, pass: 1, skip: 1 },
      ok: true,
      origin: "https://tryoverture.com",
    });
  });
});
