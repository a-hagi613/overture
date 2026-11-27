import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AUTO_MERGE_DISPATCH_STEP,
  readStepScript,
  readWorkflowStep,
} from "./workflow-config-guard.ts";

const GH_STUB = String.raw`#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const log = process.env["FIXTURE_GH_LOG"];
const counterPath = process.env["FIXTURE_STATE_COUNTER"];

if (log !== undefined) {
  appendFileSync(log, args.join(" ") + "\n");
}

if (args[0] === "pr" && args[1] === "view") {
  if (args.includes("mergeCommit")) {
    process.stdout.write((process.env["FIXTURE_MERGE_SHA"] ?? "") + "\n");
    process.exit(0);
  }

  if (args.includes("state")) {
    const states = (process.env["FIXTURE_PR_STATES"] ?? "OPEN").split(",");
    let index = 0;

    try {
      index = Number.parseInt(readFileSync(counterPath ?? "", "utf8"), 10) || 0;
    } catch {
      index = 0;
    }

    writeFileSync(counterPath ?? "/dev/null", String(index + 1));
    process.stdout.write(states[Math.min(index, states.length - 1)] + "\n");
    process.exit(0);
  }
}

if (args[0] === "api" && args[1]?.startsWith("repos/") === true) {
  process.stdout.write((process.env["FIXTURE_MAIN_SHA"] ?? "") + "\n");
  process.exit(0);
}

if (args[0] === "run" && args[1] === "list") {
  const runs = (process.env["FIXTURE_DEPLOY_RUNS"] ?? "").split(/\s+/u).filter((sha) => sha !== "");
  process.stdout.write(runs.map((sha) => sha + "\n").join(""));
  process.exit(0);
}

if (args[0] === "workflow" && args[1] === "run") {
  process.exit(0);
}

process.stderr.write("stub gh: unsupported " + args.join(" ") + "\n");
process.exit(64);
`;

const SLEEP_STUB = "#!/usr/bin/env bash\nexit 0\n";

const sandboxes: string[] = [];

/**
 * The auto-merge dispatch step's script, ready to run with bash.
 * @param autoMerge The `.github/workflows/auto-merge.yml` source.
 * @returns The `run:` body, empty when the step is missing.
 */
export function autoMergeDispatchScript(autoMerge: string) {
  return readStepScript(readWorkflowStep(autoMerge, AUTO_MERGE_DISPATCH_STEP) ?? "");
}

export interface DispatchRunInput {
  /** The pull request states the stub reports, in order; the last one repeats. */
  readonly states?: readonly string[];
  /** The squash commit the merged pull request points at. */
  readonly mergeSha?: string;
  /** `main`'s HEAD when the step reads it. */
  readonly mainSha?: string;
  /** The commit SHAs Deploy already has a run for. */
  readonly deployRuns?: readonly string[];
  /** Extra environment values, such as `MERGE_WAIT_SECONDS`. */
  readonly vars?: Record<string, string>;
}

/**
 * A sandbox with the `gh` and `sleep` stubs on `PATH`. `run` executes the dispatch step's script with bash exactly as
 * GitHub Actions does, with the step's own environment passed explicitly and every inherited value kept.
 * @returns The sandbox's `run`, which reports the exit status, combined output and the `gh` calls made.
 */
export function deployDispatchSandbox() {
  const root = mkdtempSync(join(tmpdir(), "deploy-dispatch-"));
  const bin = join(root, "bin");
  const workDirectory = join(root, "work");
  const logPath = join(root, "gh.log");
  const counterPath = join(root, "state.counter");

  sandboxes.push(root);
  mkdirSync(bin, { recursive: true });
  mkdirSync(workDirectory, { recursive: true });
  writeFileSync(join(bin, "gh"), GH_STUB);
  writeFileSync(join(bin, "sleep"), SLEEP_STUB);
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "sleep"), 0o755);

  return {
    run(script: string, input: DispatchRunInput = {}) {
      writeFileSync(logPath, "");
      writeFileSync(counterPath, "0");

      const result = Bun.spawnSync(["bash", "-c", script], {
        cwd: workDirectory,
        env: {
          ...Bun.env,
          DEPLOY_WORKFLOW: "deploy.yml",
          FIXTURE_DEPLOY_RUNS: (input.deployRuns ?? []).join(" "),
          FIXTURE_GH_LOG: logPath,
          FIXTURE_MAIN_SHA: input.mainSha ?? "main-sha",
          FIXTURE_MERGE_SHA: input.mergeSha ?? "",
          FIXTURE_PR_STATES: (input.states ?? ["OPEN"]).join(","),
          FIXTURE_STATE_COUNTER: counterPath,
          GH_TOKEN: "fixture-token",
          MERGE_WAIT_SECONDS: "3600",
          PATH: `${bin}:${Bun.env["PATH"] ?? ""}`,
          PR_URL: "https://github.com/example/repo/pull/1",
          REPO: "example/repo",
          ...input.vars,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      return {
        calls: readFileSync(logPath, "utf8")
          .split("\n")
          .filter((line) => line !== ""),
        output: `${result.stdout.toString()}${result.stderr.toString()}`,
        status: result.exitCode,
      };
    },
  };
}

/** Deletes every sandbox this process created, so a run leaves no temp trees behind even when an assertion fails. */
export function removeDeployDispatchSandboxes() {
  for (const directory of sandboxes.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
}
