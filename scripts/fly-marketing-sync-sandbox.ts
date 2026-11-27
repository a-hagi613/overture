import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import {
  flyctlRemoteCommands,
  MARKETING_SYNC_STEP,
  readStepScript,
  readWorkflowStep,
} from "./workflow-config-guard.ts";

/**
 * A deployed `dist-marketing` tree with the awkward bytes a page really carries: a NUL, invalid UTF-8, CRLF, an emoji,
 * trailing spaces and an empty file, so a byte-for-byte comparison actually proves the round trip through tar and
 * base64 instead of comparing text that survives anything.
 */
export const MARKETING_SYNC_FIXTURES = [
  [
    "index.html",
    '<!doctype html>\n<html lang="en"><head><link rel="stylesheet" href="/assets/main-abc123.js"></head><body><div id="root"></div><script type="module" src="/assets/main-abc123.js"></script></body></html>\n',
  ],
  ["_headers", "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n"],
  [
    "assets/main-abc123.js",
    Buffer.from([0x00, 0xff, 0xfe, 0x0a, 0x0d, 0x0a, 0x27, 0x22, 0x5c, 0x00, 0x7f]),
  ],
  ["assets/chunks/emoji-ü.txt", "🎉 Ünïcode — trailing spaces   \nline two\r\n"],
  ["assets/empty.txt", ""],
] as const;

const FLYCTL_STUB = String.raw`#!/usr/bin/env bun
const args = process.argv.slice(2);
const at = args.findIndex((argument) => argument === "-C" || argument === "--command");

if (at === -1) {
  console.error("stub flyctl: no -C command");
  process.exit(64);
}

function shlex(raw) {
  const words = [];
  let word = "";
  let open = false;
  let quote = null;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];

    if (quote === "'") {
      if (character === "'") quote = null;
      else word += character;
      open = true;

      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === "\\" && index + 1 < raw.length && '"\\$'.includes(raw[index + 1])) {
        word += raw[(index += 1)];
      } else {
        word += character;
      }
      open = true;

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      open = true;

      continue;
    }

    if (character === "\\" && index + 1 < raw.length) {
      word += raw[(index += 1)];
      open = true;

      continue;
    }

    if (/\s/u.test(character)) {
      if (open) {
        words.push(word);
        word = "";
        open = false;
      }

      continue;
    }

    word += character;
    open = true;
  }

  if (open) words.push(word);

  return words;
}

const app = process.env["FIXTURE_APP"] ?? "/app";
const remoteTmp = process.env["FIXTURE_REMOTE_TMP"] ?? "/tmp";
const argv = shlex(args[at + 1] ?? "").map((word) =>
  word.replaceAll(/\/tmp\/|\/app/gu, (path) => (path === "/app" ? app : remoteTmp + "/")),
);

if (argv.length === 0) {
  process.exit(64);
}

const child = Bun.spawnSync(argv, { stderr: "inherit", stdout: "inherit" });

process.exit(child.exitCode);
`;

const sandboxes: string[] = [];

const MARKETING_SYNC_TOOLS = ["bash", "awk", "base64", "find", "grep", "tar", "timeout"];

/**
 * Fails the test when a shell tool the marketing sync step shells out to is missing, instead of skipping the check:
 * the copy has to stay covered on every host the suite runs on.
 * @throws {Error} When any required tool is absent from `PATH`.
 */
export function requireMarketingSyncTools() {
  const missing = MARKETING_SYNC_TOOLS.filter((tool) => !Bun.which(tool));

  if (missing.length > 0) {
    throw new Error(
      `the marketing sync step needs ${missing.join(", ")} on PATH; install them so the copy stays covered`,
    );
  }
}

/** Deletes every sandbox this process created, so a run leaves no temp trees behind even when an assertion fails. */
export function removeMarketingSyncSandboxes() {
  for (const directory of sandboxes.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * The marketing sync step's shell script, with the YAML block indentation removed, and the remote command `flyctl` is
 * handed. Running that script is what proves the deployed workflow really extracts the page.
 * @param deploy The `.github/workflows/deploy.yml` source.
 * @returns The `run:` body, and the `-C` payload (empty when the step is missing).
 */
export function marketingSyncScript(deploy: string) {
  const step = readWorkflowStep(deploy, MARKETING_SYNC_STEP) ?? "";

  return { body: readStepScript(step), remote: flyctlRemoteCommands(step)[0] ?? "" };
}

function listFiles(root: string) {
  const files: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else {
        files.push(relative(root, path));
      }
    }
  };

  walk(root);

  return files.toSorted();
}

/**
 * Every file in a directory tree with its bytes, used to compare a real extraction against what the "machine" served.
 * @param root The directory to walk.
 * @returns Relative paths and their contents, in path order.
 */
export function snapshotTree(root: string) {
  return listFiles(root).map((path) => [path, readFileSync(join(root, path))] as const);
}

/**
 * A sandbox holding a fake deployed `/app/dist-marketing`, a `flyctl` stub on `PATH`, and a working directory for the
 * step. `run` executes the step's script with bash exactly as GitHub Actions does, against the stub, with `TMPDIR`
 * and the machine's `/tmp` both mapped inside the sandbox so a failed run leaves nothing behind on the host.
 *
 * The stub reproduces the machine side of `flyctl ssh console -C`: the SSH server word-splits the command with
 * shell-like quoting (go-shlex) and then execs `argv[0]` with no shell, so `;`, `|` and `&&` stay inert arguments and
 * only an explicit `sh -c '…'` makes the machine interpret them. It stands in for the container's `/app` through
 * `FIXTURE_APP`, and ignores the flags the workflow passes (`-q`, `-a`).
 * @returns The sandbox's paths and a `run` that executes a step script in it.
 */
export function marketingSyncSandbox() {
  requireMarketingSyncTools();

  const root = mkdtempSync(join(tmpdir(), "fly-marketing-sync-"));
  const bin = join(root, "bin");
  const workDirectory = join(root, "work");
  const appDirectory = join(root, "app");
  const localTmp = join(root, "tmp");
  const remoteTmp = join(root, "remote-tmp");

  sandboxes.push(root);
  mkdirSync(bin, { recursive: true });
  mkdirSync(workDirectory, { recursive: true });
  mkdirSync(localTmp, { recursive: true });
  mkdirSync(remoteTmp, { recursive: true });
  writeFileSync(join(bin, "flyctl"), FLYCTL_STUB);
  chmodSync(join(bin, "flyctl"), 0o755);

  for (const [path, contents] of MARKETING_SYNC_FIXTURES) {
    const target = join(appDirectory, "dist-marketing", path);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }

  return {
    appDirectory,
    remoteTmp,
    workDirectory,
    run(body: string) {
      const result = Bun.spawnSync(["bash", "-c", body], {
        cwd: workDirectory,
        env: {
          ...Bun.env,
          FIXTURE_APP: appDirectory,
          FIXTURE_REMOTE_TMP: remoteTmp,
          PATH: `${bin}:${Bun.env["PATH"] ?? ""}`,
          TMPDIR: localTmp,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      return {
        output: `${result.stdout.toString()}${result.stderr.toString()}`,
        status: result.exitCode,
      };
    },
  };
}
