import { describe, expect, test } from "bun:test";

import type { CheckOptions, CheckResult, ProbeResponse } from "./check-admin-host.ts";

import {
  allChecksPassed,
  certificateReady,
  classifyProbe,
  describeAddresses,
  exitCodeFor,
  humanReport,
  isAccessRedirectLocation,
  jsonReport,
  missingAccessSecrets,
  parseArguments,
  parseCertificateStatus,
  secretNamesFrom,
} from "./check-admin-host.ts";

function issuedCertificate(json: string) {
  return certificateReady(parseCertificateStatus(json));
}

const options: CheckOptions = {
  fly: false,
  flyApp: "overture-web",
  host: "admin.tryoverture.com",
  json: false,
  origin: "https://admin.tryoverture.com",
};

function probeOf(overrides: Partial<ProbeResponse>) {
  return {
    bodyText: "",
    contentType: "application/json",
    location: null,
    status: 200,
    ...overrides,
  } satisfies ProbeResponse;
}

describe("check-admin-host arguments", () => {
  test("defaults to the admin origin and its hostname", () => {
    const parsed = parseArguments([], "https://admin.tryoverture.com");

    expect(parsed).toEqual({
      kind: "options",
      options: {
        fly: true,
        flyApp: "overture-web",
        host: "admin.tryoverture.com",
        json: false,
        origin: "https://admin.tryoverture.com",
      },
    });
  });

  test("reads --origin, --host, --json, --no-fly and --fly-app", () => {
    const parsed = parseArguments(
      [
        "--origin",
        "https://admin.example.test",
        "--host",
        "admin.example.test",
        "--json",
        "--no-fly",
        "--fly-app",
        "another-app",
      ],
      "https://admin.tryoverture.com",
    );

    expect(parsed).toEqual({
      kind: "options",
      options: {
        fly: false,
        flyApp: "another-app",
        host: "admin.example.test",
        json: true,
        origin: "https://admin.example.test",
      },
    });
  });

  test("--host alone keeps the origin's hostname out of the way", () => {
    const parsed = parseArguments(["--host", "portal.example.test"], "https://admin.example.test");

    expect(parsed.kind).toBe("options");

    if (parsed.kind === "options") {
      expect(parsed.options.host).toBe("portal.example.test");
      expect(parsed.options.origin).toBe("https://admin.example.test");
    }
  });

  test("an origin with a path is reduced to its origin", () => {
    const parsed = parseArguments(
      ["--origin", "https://admin.example.test/ignored"],
      "https://x.test",
    );

    expect(parsed.kind).toBe("options");

    if (parsed.kind === "options") {
      expect(parsed.options.origin).toBe("https://admin.example.test");
      expect(parsed.options.host).toBe("admin.example.test");
    }
  });

  test("refuses a flag without a value, an unknown flag and a non-URL origin", () => {
    for (const args of [
      ["--origin"],
      ["--wat"],
      ["--origin", "not-a-url"],
      ["--host", "bad host"],
    ]) {
      expect(parseArguments(args, "https://admin.tryoverture.com").kind).toBe("error");
    }
  });

  test("refuses a plain http origin", () => {
    const parsed = parseArguments(["--origin", "http://admin.example.test"], "https://x.test");

    expect(parsed).toEqual({
      kind: "error",
      message: "--origin must be https: the checks read a production admin host",
    });
  });

  test("refuses any non-https scheme, not only http", () => {
    for (const origin of ["ftp://admin.example.test", "wss://admin.example.test"]) {
      expect(parseArguments(["--origin", origin], "https://x.test").kind).toBe("error");
    }
  });

  test("asks for help without probing", () => {
    expect(parseArguments(["--help"], "https://admin.tryoverture.com")).toEqual({ kind: "help" });
  });
});

describe("check-admin-host probe classification", () => {
  test("only an https Cloudflare Access host is a sign-in redirect", () => {
    for (const location of [
      "https://overture.cloudflareaccess.com/cdn-cgi/access/login",
      "https://cloudflareaccess.com/cdn-cgi/access/login",
    ]) {
      expect(isAccessRedirectLocation(location), location).toBe(true);
    }

    for (const location of [
      "https://evil.example/?next=cloudflareaccess.com",
      "https://cloudflareaccess.com.evil.example/login",
      "http://overture.cloudflareaccess.com/cdn-cgi/access/login",
      "not a url",
      "",
    ]) {
      expect(isAccessRedirectLocation(location), location).toBe(false);
    }

    expect(isAccessRedirectLocation(null)).toBe(false);
  });

  test("a Cloudflare Access redirect passes", () => {
    const result = classifyProbe(
      probeOf({
        location: "https://overture.cloudflareaccess.com/cdn-cgi/access/login",
        status: 302,
      }),
      "",
    );

    expect(result).toEqual({
      detail: "Cloudflare Access asks for sign-in before the admin API",
      name: "https",
      status: "pass",
    });
  });

  test("a redirect anywhere else fails", () => {
    const result = classifyProbe(
      probeOf({ location: "https://admin.tryoverture.com/signin", status: 302 }),
      "",
    );

    expect(result.status).toBe("fail");
  });

  test("a 401 access_required from the admin API passes", () => {
    const result = classifyProbe(
      probeOf({ bodyText: JSON.stringify({ error: "access_required" }), status: 401 }),
      "",
    );

    expect(result.status).toBe("pass");
    expect(result.detail).toBe("The admin API refuses a request with no Access credential");
  });

  test("a 401 without the access_required code fails", () => {
    expect(
      classifyProbe(
        probeOf({ bodyText: JSON.stringify({ error: "sign_in_required" }), status: 401 }),
        "",
      ).status,
    ).toBe("fail");
  });

  test("a 200 text/html app shell is the SPA bug and fails", () => {
    const result = classifyProbe(
      probeOf({
        bodyText: "<!doctype html>",
        contentType: "text/html; charset=utf-8",
        status: 200,
      }),
      "",
    );

    expect(result).toEqual({
      detail:
        "The host served the app shell as 200 text/html: /admin/api is not reaching the admin host",
      name: "https",
      status: "fail",
    });
  });

  test("a 200 JSON with no Access gate fails", () => {
    expect(classifyProbe(probeOf({ bodyText: "{}", status: 200 }), "").status).toBe("fail");
  });

  test("an unexpected status fails", () => {
    expect(classifyProbe(probeOf({ status: 503 }), "").status).toBe("fail");
  });

  test("a TLS or DNS failure fails", () => {
    expect(classifyProbe(null, "CERT_HAS_EXPIRED: certificate has expired").detail).toBe(
      "TLS certificate or handshake failed: CERT_HAS_EXPIRED: certificate has expired",
    );
    expect(classifyProbe(null, "getaddrinfo ENOTFOUND admin.example.test").detail).toBe(
      "The host did not answer: getaddrinfo ENOTFOUND admin.example.test",
    );
  });
});

describe("check-admin-host Fly output", () => {
  test("reads secret names without values or digests", () => {
    const output = [
      "NAME                    DIGEST                           CREATED AT",
      "ADMIN_ORIGIN            8f14e45fceea167a5a36dedd4bea2543 3w",
      "CF_ACCESS_AUD           c9f0f895fb98ab9159f51fd0297e236d 3w",
      "BETTER_AUTH_SECRET      45c48cce2e2d7fbdea1afc51c7c6ad26 5w",
      "",
    ].join("\n");

    expect(secretNamesFrom(output)).toEqual([
      "ADMIN_ORIGIN",
      "CF_ACCESS_AUD",
      "BETTER_AUTH_SECRET",
    ]);
  });

  test("names the missing Access secrets in a fixed order", () => {
    expect(missingAccessSecrets([])).toEqual([
      "ADMIN_ORIGIN",
      "CF_ACCESS_AUD",
      "CF_ACCESS_TEAM_DOMAIN",
    ]);
    expect(missingAccessSecrets(["ADMIN_ORIGIN", "CF_ACCESS_AUD"])).toEqual([
      "CF_ACCESS_TEAM_DOMAIN",
    ]);
  });

  test("the team domain is required and a JWKS URL cannot replace it", () => {
    expect(
      missingAccessSecrets(["ADMIN_ORIGIN", "CF_ACCESS_AUD", "CF_ACCESS_TEAM_DOMAIN"]),
    ).toEqual([]);
    expect(missingAccessSecrets(["ADMIN_ORIGIN", "CF_ACCESS_AUD", "CF_ACCESS_JWKS_URL"])).toEqual([
      "CF_ACCESS_TEAM_DOMAIN",
    ]);
    expect(
      missingAccessSecrets([
        "ADMIN_ORIGIN",
        "CF_ACCESS_AUD",
        "CF_ACCESS_TEAM_DOMAIN",
        "CF_ACCESS_JWKS_URL",
      ]),
    ).toEqual([]);
  });

  test("an audience without an origin is still missing the origin", () => {
    expect(missingAccessSecrets(["CF_ACCESS_AUD", "CF_ACCESS_TEAM_DOMAIN"])).toEqual([
      "ADMIN_ORIGIN",
    ]);
  });

  test("recognises an issued certificate in flyctl's JSON", () => {
    const issued = JSON.stringify({
      ClientStatus: "Ready",
      Configured: true,
      Hostname: "admin.tryoverture.com",
      Issued: [{ Serial: "abc", Status: "Issued" }],
    });

    expect(issuedCertificate(issued)).toBe(true);
    expect(issuedCertificate(JSON.stringify({ ClientStatus: "Ready", Configured: true }))).toBe(
      true,
    );
    expect(
      issuedCertificate(JSON.stringify({ ClientStatus: "Ready", Configured: true, Issued: true })),
    ).toBe(true);
  });

  test("a pending or unverified certificate is not issued", () => {
    const pending = JSON.stringify({
      ClientStatus: "Not verified",
      Configured: false,
      Hostname: "admin.tryoverture.com",
      Issued: [],
    });

    expect(issuedCertificate(pending)).toBe(false);
    expect(certificateReady(parseCertificateStatus(pending))).toBe(false);
  });

  test("a ready status on an unconfigured hostname is not an issued certificate", () => {
    expect(
      issuedCertificate(JSON.stringify({ ClientStatus: "Ready", Configured: false, Issued: [] })),
    ).toBe(false);
  });

  test("invalid JSON and an unrecognised shape fail with a clean message", () => {
    expect(() => parseCertificateStatus("Status = Issued\n")).toThrow(/did not print JSON/u);
    expect(() =>
      parseCertificateStatus(JSON.stringify({ Hostname: "admin.example.test" })),
    ).toThrow(/does not recognise/u);
  });

  test("renders every resolved address and notes an empty answer", () => {
    expect(
      describeAddresses([
        { address: "203.0.113.10", family: 4 },
        { address: "2001:db8::1", family: 6 },
      ]),
    ).toBe("resolves to 203.0.113.10 (IPv4), 2001:db8::1 (IPv6)");
    expect(describeAddresses([])).toBe("the resolver returned no address");
  });
});

describe("check-admin-host report", () => {
  const passing: CheckResult[] = [
    { detail: "resolves", name: "dns", status: "pass" },
    { detail: "refuses", name: "https", status: "pass" },
    { detail: "skipped by --no-fly", name: "cert", status: "skip" },
  ];

  test("every check passing or skipped exits 0", () => {
    expect(allChecksPassed(passing)).toBe(true);
    expect(exitCodeFor(passing)).toBe(0);
  });

  test("one failing check exits 1", () => {
    const failing = [...passing, { detail: "missing", name: "secrets", status: "fail" } as const];

    expect(allChecksPassed(failing)).toBe(false);
    expect(exitCodeFor(failing)).toBe(1);
  });

  test("the human report names every check and the verdict", () => {
    const report = humanReport(options, passing);

    expect(report).toContain("dns");
    expect(report).toContain("PASS");
    expect(report).toContain("SKIP");
    expect(report).toContain("passes every check");
  });

  test("the JSON report carries the checks and never a secret value", () => {
    const report = jsonReport(options, passing);
    const parsed: unknown = JSON.parse(report);

    expect(parsed).toEqual({
      checks: passing,
      host: "admin.tryoverture.com",
      ok: true,
      origin: "https://admin.tryoverture.com",
    });
    expect(report).not.toContain("8f14e45fceea167a5a36dedd4bea2543");
  });
});
