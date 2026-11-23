import { lookup } from "node:dns/promises";

import { z } from "zod";

const DEFAULT_ORIGIN = "https://tryoverture.com";
const DEFAULT_ADMIN_ORIGIN = "https://admin.tryoverture.com";
const REQUEST_TIMEOUT_MS = 10_000;
const DNS_TIMEOUT_MS = 10_000;
const MISSING_ASSET_PATH = "/assets/definitely-missing-wave5-check.js";
const ACCESS_HOST = "cloudflareaccess.com";

const PRODUCTION_PRICING_COPY = ["Pay only for applications", "$9.99", "$29.99"] as const;
const NAVIGATION_PATHS = ["/settings/billing", "/pricing", "/search", "/inbox/address"] as const;
const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const HSTS_PATTERN = /max-age=\d+/u;
const CSP_PATTERN = /default-src/u;

const healthSchema = z.looseObject({
  database: z.string(),
  status: z.string(),
});

const anonymousMeSchema = z.looseObject({ user: z.null() });

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  detail: string;
  ms: number;
  name: string;
  status: CheckStatus;
}

export interface CheckOptions {
  adminOrigin: string;
  json: boolean;
  origin: string;
}

export interface ProbeRequest {
  body?: string;
  method: "GET" | "POST";
  redirect?: "follow" | "manual";
}

export interface ProbeResponse {
  bodyText: string;
  headers: Readonly<Record<string, string>>;
  status: number;
}

export type ProbeFetch = (url: string, request: ProbeRequest) => Promise<ProbeResponse>;

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (host: string) => Promise<ResolvedAddress[]>;

export interface CheckDependencies {
  fetchPage: ProbeFetch;
  resolveHost: HostResolver;
}

interface ProbeOutcome {
  failure: string;
  ms: number;
  response: ProbeResponse | null;
}

export type ParsedArguments =
  | { kind: "options"; options: CheckOptions }
  | { kind: "help" }
  | { kind: "error"; message: string };

function defaultDependencies() {
  return {
    fetchPage,
    resolveHost: defaultResolveHost,
  } satisfies CheckDependencies;
}

function optionsFrom(origin: string, adminOrigin: string, json: boolean) {
  return {
    adminOrigin: new URL(adminOrigin).origin,
    json,
    origin: new URL(origin).origin,
  } satisfies CheckOptions;
}

/**
 * Turns command-line arguments into check options.
 * @param args The arguments after the script name.
 * @returns The options, a help request, or an error message.
 */
export function parseArguments(args: readonly string[]) {
  let origin = DEFAULT_ORIGIN;
  let adminOrigin = DEFAULT_ADMIN_ORIGIN;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--json") {
      json = true;
    } else if (argument === "--help" || argument === "-h") {
      return { kind: "help" } satisfies ParsedArguments;
    } else if (argument === "--origin" || argument === "--admin-origin") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return {
          kind: "error",
          message: `${argument} needs a value`,
        } satisfies ParsedArguments;
      }

      if (argument === "--origin") {
        origin = value;
      } else {
        adminOrigin = value;
      }

      index += 1;
    } else {
      return {
        kind: "error",
        message: `Unknown argument: ${argument}`,
      } satisfies ParsedArguments;
    }
  }

  for (const [flag, value] of [
    ["--origin", origin],
    ["--admin-origin", adminOrigin],
  ] as const) {
    if (!isHttpsOrigin(value)) {
      return {
        kind: "error",
        message: `${flag} must be an https URL: ${value}`,
      } satisfies ParsedArguments;
    }
  }

  return {
    kind: "options",
    options: optionsFrom(origin, adminOrigin, json),
  } satisfies ParsedArguments;
}

function isHttpsOrigin(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

function header(response: ProbeResponse, name: string) {
  return response.headers[name.toLowerCase()] ?? null;
}

function contentTypeOf(response: ProbeResponse) {
  return header(response, "content-type");
}

function isHtml(response: ProbeResponse) {
  return (contentTypeOf(response) ?? "").toLowerCase().includes("text/html");
}

/**
 * Whether the landing carries every pricing string the app ships.
 * @param bodyText The landing's HTML.
 * @returns The production strings that are missing.
 */
export function missingPricingCopy(bodyText: string) {
  return PRODUCTION_PRICING_COPY.filter((copy) => !bodyText.includes(copy));
}

/**
 * Whether a redirect target is a Cloudflare Access sign-in page.
 * @param location The `Location` header, or null when there was none.
 * @returns True only for an `https` URL on the Cloudflare Access host.
 */
export function isAccessRedirect(location: string | null) {
  if (location === null) {
    return false;
  }

  try {
    const parsed = new URL(location);

    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === ACCESS_HOST || parsed.hostname.endsWith(`.${ACCESS_HOST}`))
    );
  } catch {
    return false;
  }
}

function failed(outcome: ProbeOutcome, detail: string) {
  return {
    detail: outcome.failure === "" ? detail : `${detail}; ${outcome.failure}`,
    status: "fail",
  } satisfies Pick<CheckResult, "detail" | "status">;
}

function passed(outcome: ProbeOutcome, detail: string) {
  return { detail, status: "pass" } satisfies Pick<CheckResult, "detail" | "status">;
}

/**
 * Classifies a response whose body must not leak identity without a session.
 *
 * `GET /api/me` answers `200` with `user: null` for an anonymous visitor (#512), while the
 * session-scoped endpoints answer `401`; both prove the guard ran.
 * @param outcome The probe outcome.
 * @returns The check result without the check name or timing.
 */
export function classifyAnonymousMe(outcome: ProbeOutcome) {
  const { response } = outcome;

  if (response === null) {
    return failed(outcome, "did not answer");
  }

  if (response.status === 401) {
    return passed(outcome, "refuses with 401 sign_in_required");
  }

  if (response.status !== 200) {
    return failed(
      outcome,
      `answered ${String(response.status)} instead of 401 or the anonymous 200`,
    );
  }

  try {
    const parsed = anonymousMeSchema.safeParse(JSON.parse(response.bodyText));

    if (parsed.success) {
      return passed(outcome, "answers 200 with user: null, the anonymous payload");
    }
  } catch {
    return failed(outcome, "answered 200 with a body that is not JSON");
  }

  return failed(outcome, "answered 200 without the anonymous payload");
}

function result(
  name: string,
  outcome: ProbeOutcome,
  verdict: Pick<CheckResult, "detail" | "status">,
) {
  return { ...verdict, ms: outcome.ms, name } satisfies CheckResult;
}

async function probe(dependencies: CheckDependencies, url: string, request: ProbeRequest) {
  const started = performance.now();

  try {
    const response = await dependencies.fetchPage(url, request);

    return { failure: "", ms: Math.round(performance.now() - started), response };
  } catch (error) {
    return {
      failure: error instanceof Error ? error.message : String(error),
      ms: Math.round(performance.now() - started),
      response: null,
    };
  }
}

function landingCheck(outcome: ProbeOutcome) {
  const { response } = outcome;

  if (response === null) {
    return result("landing", outcome, failed(outcome, "did not answer"));
  }

  if (response.status !== 200) {
    return result("landing", outcome, failed(outcome, `answered ${String(response.status)}`));
  }

  const missing = missingPricingCopy(response.bodyText);

  if (missing.length > 0) {
    return result(
      "landing",
      outcome,
      failed(outcome, `is missing the approved pricing copy: ${missing.join(", ")}`),
    );
  }

  return result("landing", outcome, passed(outcome, "200 with the approved pricing copy"));
}

function healthCheck(outcome: ProbeOutcome) {
  const { response } = outcome;

  if (response === null) {
    return result("health", outcome, failed(outcome, "did not answer"));
  }

  if (response.status !== 200) {
    return result("health", outcome, failed(outcome, `answered ${String(response.status)}`));
  }

  try {
    const parsed = healthSchema.safeParse(JSON.parse(response.bodyText));

    if (parsed.success && parsed.data.status === "ok" && parsed.data.database === "ok") {
      const keys = Object.keys(parsed.data).toSorted().join(", ");

      return result("health", outcome, passed(outcome, `200 ok (database ok) with ${keys}`));
    }
  } catch {
    return result("health", outcome, failed(outcome, "answered 200 without a JSON body"));
  }

  return result(
    "health",
    outcome,
    failed(outcome, "answered 200 without status and database both ok"),
  );
}

function signinCheck(outcome: ProbeOutcome) {
  const { response } = outcome;

  if (response === null) {
    return result("signin", outcome, failed(outcome, "did not answer"));
  }

  if (response.status !== 200) {
    return result("signin", outcome, failed(outcome, `answered ${String(response.status)}`));
  }

  return result(
    "signin",
    outcome,
    passed(outcome, `200 ${contentTypeOf(response) ?? "no content type"}`),
  );
}

function headerChecks(outcome: ProbeOutcome) {
  const { response } = outcome;

  const headers = [
    {
      fails: "the landing has no Content-Security-Policy with default-src",
      name: "headers.content-security-policy",
      passes: "CSP with default-src",
      valid: (value: string) => CSP_PATTERN.test(value),
      value: () => (response === null ? null : header(response, "content-security-policy")),
    },
    {
      fails: "the landing has no X-Content-Type-Options: nosniff",
      name: "headers.content-type-options",
      passes: "nosniff",
      valid: (value: string) => value.toLowerCase() === "nosniff",
      value: () => (response === null ? null : header(response, "x-content-type-options")),
    },
    {
      fails: "the landing has no Referrer-Policy",
      name: "headers.referrer-policy",
      passes: "Referrer-Policy set",
      valid: (value: string) => value.trim() !== "",
      value: () => (response === null ? null : header(response, "referrer-policy")),
    },
    {
      fails: "the landing has no X-Frame-Options",
      name: "headers.frame-options",
      passes: "X-Frame-Options set",
      valid: (value: string) => ["deny", "sameorigin"].includes(value.toLowerCase()),
      value: () => (response === null ? null : header(response, "x-frame-options")),
    },
  ] as const;

  return headers.map(({ fails, name, passes, valid, value }) => {
    if (response === null) {
      return result(name, outcome, failed(outcome, "the landing did not answer"));
    }

    const headerValue = value();

    if (headerValue === null || !valid(headerValue)) {
      return result(name, outcome, failed(outcome, fails));
    }

    return result(name, outcome, passed(outcome, passes));
  });
}

function hstsCheck(outcome: ProbeOutcome, origin: string) {
  const { response } = outcome;
  const host = new URL(origin).hostname;

  if (LOCAL_HOSTS.has(host)) {
    return result("headers.hsts", outcome, {
      detail: `skipped: HSTS is not served on ${host}`,
      status: "skip",
    });
  }

  if (response === null) {
    return result("headers.hsts", outcome, failed(outcome, "the landing did not answer"));
  }

  const value = header(response, "strict-transport-security");

  if (value === null || !HSTS_PATTERN.test(value)) {
    return result("headers.hsts", outcome, failed(outcome, "the landing has no HSTS max-age"));
  }

  return result("headers.hsts", outcome, passed(outcome, `HSTS ${value}`));
}

function serviceWorkerCheck(outcome: ProbeOutcome) {
  const { response } = outcome;

  if (response === null) {
    return result("sw.cache", outcome, failed(outcome, "did not answer"));
  }

  if (response.status !== 200) {
    return result("sw.cache", outcome, failed(outcome, `answered ${String(response.status)}`));
  }

  const cacheControl = header(response, "cache-control");

  if (cacheControl === null || !cacheControl.toLowerCase().includes("no-cache")) {
    return result(
      "sw.cache",
      outcome,
      failed(
        outcome,
        `/sw.js carries cache-control "${cacheControl ?? "none"}" instead of no-cache, so a CDN can pin the service worker`,
      ),
    );
  }

  return result("sw.cache", outcome, passed(outcome, "200 with cache-control: no-cache"));
}

function missingAssetCheck(outcome: ProbeOutcome) {
  const { response } = outcome;

  if (response === null) {
    return result("assets.404", outcome, failed(outcome, "did not answer"));
  }

  if (response.status === 404) {
    return result("assets.404", outcome, passed(outcome, "404 for a missing asset"));
  }

  if (response.status === 200 && isHtml(response)) {
    return result("assets.404", outcome, {
      detail:
        "skipped: the SPA fallback still answers a missing asset with 200 text/html; the 404 fix lands in a later deploy",
      status: "skip",
    });
  }

  return result(
    "assets.404",
    outcome,
    failed(outcome, `answered ${String(response.status)} ${contentTypeOf(response) ?? ""}`.trim()),
  );
}

function stripeWebhookCheck(outcome: ProbeOutcome) {
  const { response } = outcome;

  if (response === null) {
    return result("api.stripe-webhook", outcome, failed(outcome, "did not answer"));
  }

  if (response.status === 404) {
    return result(
      "api.stripe-webhook",
      outcome,
      failed(outcome, "404: the Stripe webhook is not mounted, the Wave 4 bug"),
    );
  }

  if (response.status === 400 || response.status === 401) {
    return result(
      "api.stripe-webhook",
      outcome,
      passed(outcome, `${String(response.status)} for a request with no signature`),
    );
  }

  return result(
    "api.stripe-webhook",
    outcome,
    failed(outcome, `answered ${String(response.status)} instead of 400 or 401`),
  );
}

function unauthorizedCheck(
  name: string,
  outcome: ProbeOutcome,
  expected: readonly number[],
  passDetail: string,
) {
  const { response } = outcome;

  if (response === null) {
    return result(name, outcome, failed(outcome, "did not answer"));
  }

  if (expected.includes(response.status)) {
    return result(name, outcome, passed(outcome, passDetail));
  }

  return result(
    name,
    outcome,
    failed(outcome, `answered ${String(response.status)} instead of ${expected.join(" or ")}`),
  );
}

function navigationCheck(path: string, outcome: ProbeOutcome) {
  const name = `nav${path.replaceAll("/", ".")}`;
  const { response } = outcome;

  if (response === null) {
    return result(name, outcome, failed(outcome, "did not answer"));
  }

  if (response.status !== 200 || !isHtml(response)) {
    return result(
      name,
      outcome,
      failed(
        outcome,
        `answered ${String(response.status)} ${contentTypeOf(response) ?? "no content type"}, not 200 HTML`,
      ),
    );
  }

  return result(name, outcome, passed(outcome, "200 text/html, the app shell"));
}

/**
 * Renders the addresses a DNS lookup returned.
 * @param addresses The resolver's answer.
 * @returns One address list, or a note that the resolver returned none.
 */
export function describeAddresses(addresses: readonly ResolvedAddress[]) {
  if (addresses.length === 0) {
    return "the resolver returned no address";
  }

  return `resolves to ${addresses
    .map((resolved) => `${resolved.address} (IPv${String(resolved.family)})`)
    .join(", ")}`;
}

const ADMIN_NEXT_STEP =
  "next step: add the Fly certificate (`flyctl certs add admin.tryoverture.com -a overture-web`), a proxied Cloudflare CNAME to overture-web.fly.dev, then the Access app and the ADMIN_ORIGIN/CF_ACCESS_AUD/CF_ACCESS_TEAM_DOMAIN secrets";

async function adminDnsCheck(origin: string, resolve: HostResolver) {
  const host = new URL(origin).hostname;
  const started = performance.now();

  try {
    const addresses = await resolve(host);
    const ms = Math.round(performance.now() - started);

    if (addresses.length === 0) {
      return {
        detail: `${host} does not resolve yet; ${ADMIN_NEXT_STEP}`,
        ms,
        name: "admin.dns",
        status: "skip",
      } satisfies CheckResult;
    }

    return {
      detail: describeAddresses(addresses),
      ms,
      name: "admin.dns",
      status: "pass",
    } satisfies CheckResult;
  } catch (error) {
    return {
      detail: `${host} does not resolve (${error instanceof Error ? error.message : String(error)}); ${ADMIN_NEXT_STEP}`,
      ms: Math.round(performance.now() - started),
      name: "admin.dns",
      status: "skip",
    } satisfies CheckResult;
  }
}

/**
 * Classifies the admin API probe: only a 401/403 refusal or a Cloudflare Access redirect passes.
 * @param outcome The probe outcome.
 * @returns The admin HTTPS check result.
 */
export function classifyAdminHttps(outcome: ProbeOutcome) {
  const { response } = outcome;

  if (response === null) {
    return result("admin.https", outcome, failed(outcome, "did not answer"));
  }

  if (response.status === 401 || response.status === 403) {
    return result(
      "admin.https",
      outcome,
      passed(outcome, `${String(response.status)} without an Access credential`),
    );
  }

  if (response.status >= 300 && response.status < 400) {
    const location = header(response, "location");

    return result(
      "admin.https",
      outcome,
      isAccessRedirect(location)
        ? passed(outcome, "Cloudflare Access asks for sign-in")
        : failed(outcome, `redirected (${String(response.status)}) to ${location ?? "nowhere"}`),
    );
  }

  if (response.status === 200) {
    return result(
      "admin.https",
      outcome,
      failed(outcome, "answered 200 with no Access gate; /admin/api/session must never be public"),
    );
  }

  return result("admin.https", outcome, failed(outcome, `answered ${String(response.status)}`));
}

function adminHttpsSkipped() {
  return {
    detail: `skipped because the admin host does not resolve; ${ADMIN_NEXT_STEP}`,
    ms: 0,
    name: "admin.https",
    status: "skip",
  } satisfies CheckResult;
}

/**
 * Runs every read-only check against a deployed origin.
 * @param options The parsed options.
 * @param dependencies The fetch and DNS implementations; production by default.
 * @returns The check results in report order.
 */
export async function runChecks(
  options: CheckOptions,
  dependencies: CheckDependencies = defaultDependencies(),
) {
  const { origin } = options;
  const landing = await probe(dependencies, `${origin}/`, { method: "GET" });
  const health = await probe(dependencies, `${origin}/api/health`, { method: "GET" });
  const signin = await probe(dependencies, `${origin}/signin`, { method: "GET" });

  const serviceWorker = await probe(dependencies, `${origin}/sw.js`, { method: "GET" });

  const missingAsset = await probe(dependencies, `${origin}${MISSING_ASSET_PATH}`, {
    method: "GET",
  });

  const me = await probe(dependencies, `${origin}/api/me`, { method: "GET" });

  const results: CheckResult[] = [
    landingCheck(landing),
    healthCheck(health),
    signinCheck(signin),
    ...headerChecks(landing),
    hstsCheck(landing, origin),
    serviceWorkerCheck(serviceWorker),
    missingAssetCheck(missingAsset),
    stripeWebhookCheck(
      await probe(dependencies, `${origin}/webhooks/stripe`, {
        body: "{}",
        method: "POST",
      }),
    ),
    unauthorizedCheck(
      "api.events",
      await probe(dependencies, `${origin}/api/events`, { method: "GET" }),
      [401],
      "401 without a session",
    ),
    result("api.me", me, classifyAnonymousMe(me)),
    unauthorizedCheck(
      "api.billing-checkout",
      await probe(dependencies, `${origin}/api/billing/checkout`, {
        body: JSON.stringify({ plan: "week" }),
        method: "POST",
      }),
      [401],
      "401 without a session for a valid body",
    ),
  ];

  const navigation = await Promise.all(
    NAVIGATION_PATHS.map(async (path) =>
      navigationCheck(
        path,
        await probe(dependencies, `${origin}${path}`, { method: "GET", redirect: "follow" }),
      ),
    ),
  );

  results.push(...navigation);

  const adminDns = await adminDnsCheck(options.adminOrigin, dependencies.resolveHost);

  results.push(adminDns);

  if (adminDns.status === "skip") {
    results.push(adminHttpsSkipped());

    return results;
  }

  results.push(
    classifyAdminHttps(
      await probe(dependencies, `${options.adminOrigin}/admin/api/session`, {
        method: "GET",
      }),
    ),
  );

  return results;
}

/**
 * Whether every check passed; skipped checks never fail the run.
 * @param results The completed checks.
 * @returns True when no check failed.
 */
export function allChecksPassed(results: readonly CheckResult[]) {
  return results.every((check) => check.status !== "fail");
}

/**
 * The process exit code for a finished run.
 * @param results The completed checks.
 * @returns 0 when every check passed or was skipped, 1 otherwise.
 */
export function exitCodeFor(results: readonly CheckResult[]) {
  return allChecksPassed(results) ? 0 : 1;
}

function counts(results: readonly CheckResult[]) {
  return {
    fail: results.filter((check) => check.status === "fail").length,
    pass: results.filter((check) => check.status === "pass").length,
    skip: results.filter((check) => check.status === "skip").length,
  };
}

/**
 * Renders the human-readable report.
 * @param options The options the checks ran with.
 * @param results The completed checks.
 * @returns One line per check and a verdict.
 */
export function humanReport(options: CheckOptions, results: readonly CheckResult[]) {
  const lines = results.map(
    (check) =>
      `check-production: ${check.name.padEnd(32)} ${check.status.toUpperCase().padEnd(4)} ${String(check.ms).padStart(5)} ms  ${check.detail}`,
  );

  const { fail, pass, skip } = counts(results);

  lines.push(
    `check-production: ${options.origin} ${String(pass)} passed, ${String(fail)} failed, ${String(skip)} skipped`,
  );

  return `${lines.join("\n")}\n`;
}

/**
 * Renders the machine-readable report.
 * @param options The options the checks ran with.
 * @param results The completed checks.
 * @returns The JSON document and its trailing newline.
 */
export function jsonReport(options: CheckOptions, results: readonly CheckResult[]) {
  return `${JSON.stringify(
    {
      adminOrigin: options.adminOrigin,
      checks: results,
      counts: counts(results),
      ok: allChecksPassed(results),
      origin: options.origin,
    },
    null,
    2,
  )}\n`;
}

async function fetchPage(url: string, request: ProbeRequest) {
  const init: RequestInit = {
    method: request.method,
    redirect: request.redirect ?? "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  if (request.body !== undefined) {
    init.body = request.body;
    init.headers = { "content-type": "application/json" };
  }

  const response = await fetch(url, init);
  const headers: Record<string, string> = {};

  for (const [name, value] of response.headers) {
    headers[name.toLowerCase()] = value;
  }

  return { bodyText: await response.text(), headers, status: response.status };
}

async function defaultResolveHost(host: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`the DNS lookup did not answer within ${String(DNS_TIMEOUT_MS / 1000)} s`));
    }, DNS_TIMEOUT_MS);
  });

  try {
    return await Promise.race([lookup(host, { all: true }), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function main() {
  const parsed = parseArguments(Bun.argv.slice(2));

  if (parsed.kind === "help") {
    process.stdout.write(
      "Usage: bun run scripts/check-production.ts [--origin <url>] [--admin-origin <url>] [--json]\n",
    );

    return;
  }

  if (parsed.kind === "error") {
    process.stderr.write(`check-production: ${parsed.message}\n`);
    process.exitCode = 1;

    return;
  }

  const results = await runChecks(parsed.options);

  process.stdout.write(
    parsed.options.json
      ? jsonReport(parsed.options, results)
      : humanReport(parsed.options, results),
  );
  process.exitCode = exitCodeFor(results);
}

if (import.meta.main) {
  await main();
}
