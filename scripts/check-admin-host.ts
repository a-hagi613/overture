import { lookup } from "node:dns/promises";

import { z } from "zod";

const DEFAULT_ADMIN_ORIGIN = "https://admin.tryoverture.com";
const DEFAULT_FLY_APP = "overture-web";
const PROBE_PATH = "/admin/api/session";
const PROBE_TIMEOUT_MS = 12_000;

const ACCESS_SECRET_NAMES = [
  "ADMIN_ORIGIN",
  "CF_ACCESS_AUD",
  "CF_ACCESS_TEAM_DOMAIN",
  "CF_ACCESS_JWKS_URL",
] as const;

const ACCESS_HOST = "cloudflareaccess.com";
const secretNamePattern = /^[A-Z][A-Z0-9_]*$/u;
const secretHeaders = new Set(["NAME", "DIGEST"]);
const certificateFailurePattern = /certificate|CERT_|TLS|self[- ]signed/iu;

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  detail: string;
  name: string;
  status: CheckStatus;
}

export interface CheckOptions {
  fly: boolean;
  flyApp: string;
  host: string;
  json: boolean;
  origin: string;
}

export interface ProbeResponse {
  bodyText: string;
  contentType: string | null;
  location: string | null;
  status: number;
}

export type ParsedArguments =
  | { kind: "options"; options: CheckOptions }
  | { kind: "help" }
  | { kind: "error"; message: string };

const sessionErrorSchema = z.object({ error: z.string().optional() });

function optionsFrom(origin: string, host: string, json: boolean, fly: boolean, flyApp: string) {
  const url = new URL(origin);

  return {
    fly,
    flyApp,
    host: host === "" ? url.hostname : host,
    json,
    origin: url.origin,
  };
}

/**
 * Turns command-line arguments into check options.
 * @param args The arguments after the script name.
 * @param defaultOrigin The admin origin to probe when `--origin` is absent.
 * @returns The options, a help request, or an error message.
 */
export function parseArguments(args: readonly string[], defaultOrigin: string) {
  let origin = defaultOrigin;
  let host = "";
  let json = false;
  let fly = true;
  let flyApp = DEFAULT_FLY_APP;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--json") {
      json = true;
    } else if (argument === "--no-fly") {
      fly = false;
    } else if (argument === "--help" || argument === "-h") {
      return { kind: "help" } satisfies ParsedArguments;
    } else if (argument === "--origin" || argument === "--host" || argument === "--fly-app") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return {
          kind: "error",
          message: `${argument} needs a value`,
        } satisfies ParsedArguments;
      }

      if (argument === "--origin") {
        origin = value;
      } else if (argument === "--host") {
        host = value;
      } else {
        flyApp = value;
      }

      index += 1;
    } else {
      return {
        kind: "error",
        message: `Unknown argument: ${argument}`,
      } satisfies ParsedArguments;
    }
  }

  const parsedOrigin = z.url().safeParse(origin);

  if (!parsedOrigin.success) {
    return {
      kind: "error",
      message: `--origin must be an absolute URL: ${origin}`,
    } satisfies ParsedArguments;
  }

  if (parsedOrigin.data.startsWith("http://")) {
    return {
      kind: "error",
      message: "--origin must be https: the checks read a production admin host",
    } satisfies ParsedArguments;
  }

  if (
    host !== "" &&
    !z
      .string()
      .min(1)
      .regex(/^[a-z0-9.-]+$/u)
      .safeParse(host).success
  ) {
    return {
      kind: "error",
      message: `--host is not a hostname: ${host}`,
    } satisfies ParsedArguments;
  }

  return {
    kind: "options",
    options: optionsFrom(parsedOrigin.data, host, json, fly, flyApp),
  } satisfies ParsedArguments;
}

/**
 * Classifies the admin API probe response.
 * @param response What the probe saw, if it got a response at all.
 * @param failure The error text when the request never completed.
 * @returns The probe result.
 */
export function classifyProbe(response: ProbeResponse | null, failure: string) {
  if (response === null) {
    return {
      detail: certificateFailurePattern.test(failure)
        ? `TLS certificate or handshake failed: ${failure}`
        : `The host did not answer: ${failure}`,
      name: "https",
      status: "fail",
    } satisfies CheckResult;
  }

  const { bodyText, contentType, location, status } = response;

  if (status >= 300 && status < 400) {
    const accessRedirect = location?.includes(ACCESS_HOST) === true;

    return {
      detail: accessRedirect
        ? "Cloudflare Access asks for sign-in before the admin API"
        : `The host redirected (${String(status)}) to ${location ?? "an unknown location"}`,
      name: "https",
      status: accessRedirect ? "pass" : "fail",
    } satisfies CheckResult;
  }

  if (status === 401) {
    const refused = errorCodeFrom(bodyText) === "access_required";

    return {
      detail: refused
        ? "The admin API refuses a request with no Access credential"
        : "The admin API answered 401 without the access_required code",
      name: "https",
      status: refused ? "pass" : "fail",
    } satisfies CheckResult;
  }

  if (status === 200 && (contentType ?? "").includes("text/html")) {
    return {
      detail:
        "The host served the app shell as 200 text/html: /admin/api is not reaching the admin host",
      name: "https",
      status: "fail",
    } satisfies CheckResult;
  }

  if (status === 200) {
    return {
      detail:
        "The admin API answered with no Access gate: it should redirect or refuse without an Access credential",
      name: "https",
      status: "fail",
    } satisfies CheckResult;
  }

  return {
    detail: `The admin API answered ${String(status)}`,
    name: "https",
    status: "fail",
  } satisfies CheckResult;
}

function errorCodeFrom(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    const body = sessionErrorSchema.safeParse(parsed);

    return body.success ? (body.data.error ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Reads the secret names out of `flyctl secrets list` output.
 * @param output The command's stdout.
 * @returns Every secret name, without any value or digest.
 */
export function secretNamesFrom(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim().split(/\s+/u)[0] ?? "")
    .filter((name) => secretNamePattern.test(name) && !secretHeaders.has(name));
}

/**
 * Names the Cloudflare Access secrets that are missing from Fly.
 * @param present The secret names Fly reports.
 * @returns The required names that are absent.
 */
export function missingAccessSecrets(present: readonly string[]) {
  const available = new Set(present);

  return ACCESS_SECRET_NAMES.filter((name) => !available.has(name));
}

/**
 * Whether `flyctl certs show` reports an issued certificate.
 * @param output The command's combined output.
 * @returns True when Fly says the certificate is issued.
 */
export function certificateIssued(output: string) {
  return /\bIssued\b/u.test(output) || /"is\.[A-Za-z0-9]+\.acm-validations\.aws"/u.test(output);
}

/**
 * Whether every check passed; skipped checks never fail the run.
 * @param results The completed checks.
 * @returns True when no check failed.
 */
export function allChecksPassed(results: readonly CheckResult[]) {
  return results.every((result) => result.status !== "fail");
}

/**
 * Renders the human-readable report.
 * @param options The options the checks ran with.
 * @param results The completed checks.
 * @returns One line per check and a verdict.
 */
export function humanReport(options: CheckOptions, results: readonly CheckResult[]) {
  const lines = results.map(
    (result) =>
      `check-admin-host: ${result.name.padEnd(9)} ${result.status.toUpperCase().padEnd(4)} ${result.detail}`,
  );

  lines.push(
    allChecksPassed(results)
      ? `check-admin-host: ${options.origin} passes every check`
      : `check-admin-host: ${options.origin} has gaps; see the FAIL lines above`,
  );

  return `${lines.join("\n")}\n`;
}

/**
 * Renders the machine-readable report. Secret values never enter it.
 * @param options The options the checks ran with.
 * @param results The completed checks.
 * @returns The JSON document and its trailing newline.
 */
export function jsonReport(options: CheckOptions, results: readonly CheckResult[]) {
  return `${JSON.stringify(
    {
      checks: results,
      host: options.host,
      ok: allChecksPassed(results),
      origin: options.origin,
    },
    null,
    2,
  )}\n`;
}

/**
 * The process exit code for a finished run.
 * @param results The completed checks.
 * @returns 0 when every check passed or was skipped, 1 otherwise.
 */
export function exitCodeFor(results: readonly CheckResult[]) {
  return allChecksPassed(results) ? 0 : 1;
}

async function dnsCheck(host: string) {
  try {
    const { address, family } = await lookup(host);

    return {
      detail: `resolves to ${address} (IPv${String(family)})`,
      name: "dns",
      status: "pass",
    } satisfies CheckResult;
  } catch (error) {
    return {
      detail: `does not resolve: ${error instanceof Error ? error.message : String(error)}`,
      name: "dns",
      status: "fail",
    } satisfies CheckResult;
  }
}

async function httpsCheck(origin: string) {
  const url = `${origin}${PROBE_PATH}`;

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    const bodyText = await response.text();

    return classifyProbe(
      {
        bodyText,
        contentType: response.headers.get("content-type"),
        location: response.headers.get("location"),
        status: response.status,
      },
      "",
    );
  } catch (error) {
    return classifyProbe(null, error instanceof Error ? error.message : String(error));
  }
}

function runFlyctl(args: readonly string[]) {
  const result = Bun.spawnSync({
    cmd: ["flyctl", ...args],
    stderr: "pipe",
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

function certCheck(options: CheckOptions) {
  if (!options.fly) {
    return {
      detail: "skipped by --no-fly",
      name: "cert",
      status: "skip",
    } satisfies CheckResult;
  }

  if (Bun.which("flyctl") === null) {
    return {
      detail: "flyctl is not installed, so the Fly TLS certificate was not read",
      name: "cert",
      status: "skip",
    } satisfies CheckResult;
  }

  const result = runFlyctl(["certs", "show", options.host, "-a", options.flyApp]);
  const output = `${result.stdout}${result.stderr}`;

  if (result.exitCode !== 0) {
    return {
      detail: `flyctl certs show failed for ${options.host}: ${firstLine(result.stderr)}`,
      name: "cert",
      status: "fail",
    } satisfies CheckResult;
  }

  const issued = certificateIssued(output);

  const status: CheckStatus = issued ? "pass" : "fail";

  const detail = issued
    ? `Fly holds an issued certificate for ${options.host}`
    : `Fly has no issued certificate for ${options.host}`;

  return { detail, name: "cert", status } satisfies CheckResult;
}

function secretsCheck(options: CheckOptions) {
  if (!options.fly) {
    return {
      detail: "skipped by --no-fly",
      name: "secrets",
      status: "skip",
    } satisfies CheckResult;
  }

  if (Bun.which("flyctl") === null) {
    return {
      detail: "flyctl is not installed, so the Fly secret names were not read",
      name: "secrets",
      status: "skip",
    } satisfies CheckResult;
  }

  const result = runFlyctl(["secrets", "list", "-a", options.flyApp]);

  if (result.exitCode !== 0) {
    return {
      detail: `flyctl secrets list failed for ${options.flyApp}: ${firstLine(result.stderr)}`,
      name: "secrets",
      status: "fail",
    } satisfies CheckResult;
  }

  const missing = missingAccessSecrets(secretNamesFrom(result.stdout));
  const status: CheckStatus = missing.length === 0 ? "pass" : "fail";

  const detail =
    missing.length === 0
      ? `Fly has all ${String(ACCESS_SECRET_NAMES.length)} Access secret names`
      : `Fly is missing ${missing.join(", ")}`;

  return { detail, name: "secrets", status } satisfies CheckResult;
}

function firstLine(text: string) {
  return text.trim().split("\n")[0] ?? "";
}

/**
 * Runs every read-only check against the admin host.
 * @param options The options parsed from the command line.
 * @returns The check results, in report order.
 */
export async function runChecks(options: CheckOptions) {
  const results: CheckResult[] = [
    await dnsCheck(options.host),
    await httpsCheck(options.origin),
    certCheck(options),
    secretsCheck(options),
  ];

  return results;
}

async function main() {
  const parsed = parseArguments(Bun.argv.slice(2), Bun.env.ADMIN_ORIGIN ?? DEFAULT_ADMIN_ORIGIN);

  if (parsed.kind === "help") {
    process.stdout.write(
      "Usage: bun run scripts/check-admin-host.ts [--origin <url>] [--host <name>] [--json] [--no-fly] [--fly-app <name>]\n",
    );

    return;
  }

  if (parsed.kind === "error") {
    process.stderr.write(`check-admin-host: ${parsed.message}\n`);
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
