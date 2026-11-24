import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The marketing Worker serves `dist-marketing/index.html`, which hydrates with the `/assets/*` bundle of the app
 * release that wrote it. When that HTML comes from a different build than the origin serving its assets, the
 * `main-*.js` reference 404s and React never hydrates: the live supply count stays `—`, the hero counter freezes and
 * the landing's motion never starts (the production incident this script exists to prevent). The deploy workflow runs
 * it against `https://overture-web.fly.dev` before the Worker ships and against `https://tryoverture.com/` after, so a
 * mismatch fails the deploy instead of a visitor's page.
 */

export const DEFAULT_MARKETING_DIR = "dist-marketing";

const REQUEST_TIMEOUT_MS = 15_000;
const ASSET_REFERENCE_PATTERN = /(?:src|href)="(?<reference>\/assets\/[^"]+)"/gu;

export interface FetchedAsset {
  readonly bytes: number;
  readonly path: string;
  readonly status: number;
}

export type FetchAsset = (url: string) => Promise<{ bytes: number; status: number }>;

export interface VerifyMarketingAssetsOptions {
  readonly baseUrl: string;
  readonly references: readonly string[];
  readonly fetchAsset: FetchAsset;
  readonly attempts?: number;
  readonly pauseMs?: number;
}

export interface VerifyMarketingAssetsResult {
  readonly checked: readonly FetchedAsset[];
  readonly problems: readonly string[];
}

/**
 * Reads every `/assets/*` reference the prerendered page needs to render and hydrate.
 * @param html The prerendered marketing page.
 * @returns The unique asset paths it references, in document order.
 */
export function assetReferences(html: string) {
  const references = new Set<string>();

  for (const match of html.matchAll(ASSET_REFERENCE_PATTERN)) {
    const reference = match.groups?.reference;

    if (reference !== undefined) {
      references.add(reference);
    }
  }

  return [...references];
}

/**
 * Reads the asset references of a marketing build on disk.
 * @param directory The build root that holds `index.html`.
 * @returns The asset paths the page references.
 * @throws {Error} When the build or its asset references are missing, so a deploy can never skip the check.
 */
export function readMarketingAssetReferences(directory: string) {
  const index = join(directory, "index.html");

  if (!existsSync(index)) {
    throw new Error(`verify-marketing-assets: ${index} is missing; no page to verify.`);
  }

  const references = assetReferences(readFileSync(index, "utf8"));

  if (references.length === 0) {
    throw new Error(`verify-marketing-assets: ${index} references no /assets/ bundle to hydrate.`);
  }

  return references;
}

function withBase(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/u, "")}${path}`;
}

type AssetOutcome =
  | { readonly kind: "ok"; readonly asset: FetchedAsset }
  | { readonly kind: "problem"; readonly problem: string };

interface AttemptInput {
  readonly attempt: number;
  readonly attempts: number;
  readonly fetchAsset: FetchAsset;
  readonly path: string;
  readonly pauseMs: number;
  readonly url: string;
}

async function sleep(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeProblem(url: string, status: number, failure: string) {
  if (failure !== "") {
    return `${url} could not be fetched: ${failure}`;
  }

  if (status === 200) {
    return `${url} answered 200 with an empty body`;
  }

  return `${url} answered HTTP ${String(status)}`;
}

async function fetchUntilServed(input: AttemptInput) {
  let status = 0;
  let bytes = 0;
  let failure = "";

  try {
    ({ bytes, status } = await input.fetchAsset(input.url));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (status === 200 && bytes > 0) {
    return { asset: { bytes, path: input.path, status }, kind: "ok" } satisfies AssetOutcome;
  }

  const problem = describeProblem(input.url, status, failure);

  if (input.attempt >= input.attempts) {
    return { kind: "problem", problem } satisfies AssetOutcome;
  }

  if (input.pauseMs > 0) {
    await sleep(input.pauseMs);
  }

  return fetchUntilServed({ ...input, attempt: input.attempt + 1 });
}

/**
 * Checks every asset the marketing page references answers with a body.
 *
 * It always uses `GET` with `cache: no-store`: a `HEAD /` on `overture-web.fly.dev` once answered `503` while `GET /`
 * answered `200` (the Fly proxy answers HEAD differently while a machine is cold or restarting), a `HEAD` never proves
 * the hydrate payload downloads, and a CDN copy must not hide a missing file. Fly's assets are immutable, so the check
 * adds nothing to the origin's cost.
 * @param options The base origin, the references and how to fetch them.
 * @returns The checked assets and every problem found, empty when the page can hydrate.
 */
export async function verifyMarketingAssets(options: VerifyMarketingAssetsOptions) {
  const attempts = Math.max(1, options.attempts ?? 1);
  const pauseMs = options.pauseMs ?? 0;

  const outcomes = await Promise.all(
    options.references.map(async (path) =>
      fetchUntilServed({
        attempt: 1,
        attempts,
        fetchAsset: options.fetchAsset,
        path,
        pauseMs,
        url: withBase(options.baseUrl, path),
      }),
    ),
  );

  const checked = outcomes.flatMap((outcome) => (outcome.kind === "ok" ? [outcome.asset] : []));

  const problems = outcomes.flatMap((outcome) =>
    outcome.kind === "problem" ? [outcome.problem] : [],
  );

  return { checked, problems } satisfies VerifyMarketingAssetsResult;
}

const liveFetchAsset: FetchAsset = async (url) => {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "*/*" },
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  return { bytes: (await response.arrayBuffer()).byteLength, status: response.status };
};

interface Options {
  readonly attempts: number;
  readonly baseUrl: string;
  readonly directory: string;
}

type ParsedArguments =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: Options }
  | { readonly kind: "error"; readonly message: string };

function flagValue(name: string, args: readonly string[]) {
  const index = args.indexOf(name);

  return index === -1 ? null : (args[index + 1] ?? null);
}

/**
 * Parses the command line.
 * @param args The arguments after the script name.
 * @returns The options to verify, a help request or the reason the arguments are unusable.
 */
export function parseArguments(args: readonly string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" } satisfies ParsedArguments;
  }

  const baseUrl = flagValue("--base", args);

  if (baseUrl === null || baseUrl === "") {
    return { kind: "error", message: "--base <url> is required" } satisfies ParsedArguments;
  }

  const attemptsFlag = flagValue("--attempts", args);

  if (args.includes("--attempts") && attemptsFlag === null) {
    return {
      kind: "error",
      message: "--attempts needs a value",
    } satisfies ParsedArguments;
  }

  const attempts = attemptsFlag === null ? 1 : Number(attemptsFlag);

  if (!Number.isInteger(attempts) || attempts < 1) {
    return {
      kind: "error",
      message: "--attempts must be a positive integer",
    } satisfies ParsedArguments;
  }

  return {
    kind: "options",
    options: {
      attempts,
      baseUrl,
      directory: flagValue("--dir", args) ?? DEFAULT_MARKETING_DIR,
    },
  } satisfies ParsedArguments;
}

async function main() {
  const parsed = parseArguments(Bun.argv.slice(2));

  if (parsed.kind === "help") {
    process.stdout.write(
      "Usage: bun run scripts/verify-marketing-assets.ts --base <url> [--dir dist-marketing] [--attempts <n>]\n",
    );

    return;
  }

  if (parsed.kind === "error") {
    process.stderr.write(`verify-marketing-assets: ${parsed.message}\n`);
    process.exitCode = 1;

    return;
  }

  const { options } = parsed;

  let references: readonly string[];

  try {
    references = readMarketingAssetReferences(options.directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    process.stderr.write(`${message}\n`);
    process.exitCode = 1;

    return;
  }

  const result = await verifyMarketingAssets({
    attempts: options.attempts,
    baseUrl: options.baseUrl,
    fetchAsset: liveFetchAsset,
    pauseMs: options.attempts > 1 ? 3000 : 0,
    references,
  });

  for (const asset of result.checked) {
    process.stdout.write(`ok ${options.baseUrl}${asset.path} (${String(asset.bytes)} bytes)\n`);
  }

  if (result.problems.length === 0) {
    process.stdout.write(
      `verify-marketing-assets: ${String(result.checked.length)} asset(s) of ${options.directory}/index.html answered from ${options.baseUrl}\n`,
    );

    return;
  }

  for (const problem of result.problems) {
    process.stderr.write(
      `::error::${problem} — ${options.directory}/index.html references it, so the landing would not hydrate\n`,
    );
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
