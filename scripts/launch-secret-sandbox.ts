import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEPLOY_SECRET_GATE_STEP,
  readStepScript,
  readWorkflowStep,
  SYNC_OPS_SECRETS_STEP,
} from "./workflow-config-guard.ts";

const FLYCTL_STUB = String.raw`#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const secrets = args[0] === "secrets";

if (secrets && args[1] === "list") {
  const names = (process.env["FIXTURE_FLY_SECRETS"] ?? "").split(/\s+/u).filter((name) => name !== "");
  process.stdout.write(JSON.stringify(names.map((name) => ({ name }))) + "\n");
  process.exit(0);
}

if (secrets && args[1] === "import") {
  const standardInput = readFileSync(0, "utf8");
  writeFileSync(process.env["FIXTURE_FLY_IMPORT_OUT"] ?? "/dev/null", standardInput);
  process.exit(0);
}

process.stderr.write("stub flyctl: unsupported " + args.join(" ") + "\n");
process.exit(64);
`;

const sandboxes: string[] = [];

function readTextOrEmpty(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const REQUIRED_TOOLS = ["bash", "jq"] as const;

const STEP_ENVIRONMENT_NAMES: ReadonlySet<string> = new Set([
  "ALERT_NTFY_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_SECRETS",
  "CATALOG_REFRESH_SECRET",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "ENABLE_CATALOG_R2_HOT_SWAP",
  "FREEHIRE_API_KEY",
  "GITHUB_STEP_SUMMARY",
  "MASTER_KEY_CURRENT",
  "MASTER_KEY_V1",
  "OWNER_EMAIL",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_BACKUPS",
  "R2_BUCKET_FILES",
  "R2_SECRET_ACCESS_KEY",
  "REQUIRE_CLOUDFLARE_EMAIL_SECRETS",
  "REQUIRE_FREEHIRE_API_KEY",
  "TURNSTILE_SECRET",
  "TURNSTILE_SITE_KEY",
]);

/**
 * Fails the test when a shell tool the launch-secret steps need is missing, instead of skipping the check.
 * @throws {Error} When any required tool is absent from `PATH`.
 */
export function requireLaunchSecretTools() {
  const missing = REQUIRED_TOOLS.filter((tool) => !Bun.which(tool));

  if (missing.length > 0) {
    throw new Error(
      `the launch-secret steps need ${missing.join(", ")} on PATH; install them so the gates stay covered`,
    );
  }
}

/** Deletes every sandbox this process created, so a run leaves no temp trees behind even when an assertion fails. */
export function removeLaunchSecretSandboxes() {
  for (const directory of sandboxes.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * The deploy secret gate's script, ready to run with bash.
 * @param deploy The `.github/workflows/deploy.yml` source.
 * @returns The `run:` body, empty when the step is missing.
 */
export function deploySecretGateScript(deploy: string) {
  return readStepScript(readWorkflowStep(deploy, DEPLOY_SECRET_GATE_STEP) ?? "");
}

/**
 * The sync-ops-secrets script, ready to run with bash.
 * @param opsLive The `.github/workflows/ops-live.yml` source.
 * @returns The `run:` body, empty when the step is missing.
 */
export function opsSecretSyncScript(opsLive: string) {
  return readStepScript(readWorkflowStep(opsLive, SYNC_OPS_SECRETS_STEP) ?? "");
}

export interface LaunchSecretRunInput {
  /** The Fly secret names the stub reports, in any order. */
  readonly flySecrets?: readonly string[];
  /** Environment values the step reads, such as `REQUIRE_FREEHIRE_API_KEY`. */
  readonly vars?: Record<string, string>;
}

/**
 * A sandbox with the `flyctl` stub on `PATH`, an empty step summary and a file the captured import lands in.
 * `run` executes a step's script with bash exactly as GitHub Actions does, with every name the steps read
 * (`FREEHIRE_API_KEY`, `REQUIRE_FREEHIRE_API_KEY`, the R2 set, …) cleared from the inherited environment so a
 * host value cannot change a test; pass the ones a case needs through `vars`.
 * @returns The sandbox's `run`, which reports the exit status, combined output, step summary and imported text.
 */
export function launchSecretSandbox() {
  requireLaunchSecretTools();

  const root = mkdtempSync(join(tmpdir(), "launch-secret-"));
  const bin = join(root, "bin");
  const workDirectory = join(root, "work");
  const summaryPath = join(root, "summary.md");
  const importPath = join(root, "import.env");

  sandboxes.push(root);
  mkdirSync(bin, { recursive: true });
  mkdirSync(workDirectory, { recursive: true });
  writeFileSync(join(bin, "flyctl"), FLYCTL_STUB);
  chmodSync(join(bin, "flyctl"), 0o755);

  const baseEnv: Record<string, string> = {};

  for (const [name, value] of Object.entries(Bun.env)) {
    if (value !== undefined && !STEP_ENVIRONMENT_NAMES.has(name)) {
      baseEnv[name] = value;
    }
  }

  return {
    run(script: string, input: LaunchSecretRunInput = {}) {
      writeFileSync(summaryPath, "");
      rmSync(importPath, { force: true });

      const result = Bun.spawnSync(["bash", "-c", script], {
        cwd: workDirectory,
        env: {
          ...baseEnv,
          FIXTURE_FLY_IMPORT_OUT: importPath,
          FIXTURE_FLY_SECRETS: (input.flySecrets ?? []).join(" "),
          GITHUB_STEP_SUMMARY: summaryPath,
          PATH: `${bin}:${Bun.env["PATH"] ?? ""}`,
          ...input.vars,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      const imported = readTextOrEmpty(importPath);

      return {
        imported,
        output: `${result.stdout.toString()}${result.stderr.toString()}`,
        status: result.exitCode,
        summary: readFileSync(summaryPath, "utf8"),
      };
    },
  };
}

/** The base names the deploy gate always requires, before any opt-in switch adds more. */
export const REQUIRED_FLY_SECRETS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_BACKUPS",
  "R2_BUCKET_FILES",
  "OWNER_EMAIL",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET",
  "BETTER_AUTH_SECRET",
  "MASTER_KEY_V1",
] as const;
