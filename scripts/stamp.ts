import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

const STAMP_TTL_SECONDS = 30 * 60;
const STAMP_FILENAME = "verify-stamp";

const stampSchema = z.object({
  version: z.literal(1),
  timestampSeconds: z.number().int().nonnegative(),
  fingerprint: z.string().min(1),
});

function runGit(args: readonly string[], cwd: string) {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdoutBytes: result.stdout,
    stdoutText: result.stdout.toString(),
  };
}

function nowEpochSeconds() {
  return Math.floor((performance.timeOrigin + performance.now()) / 1000);
}

export function resolveVerifyStampPath(cwd: string) {
  const gitDir = runGit(["rev-parse", "--git-dir"], cwd);

  if (gitDir.exitCode !== 0) {
    return null;
  }

  const trimmed = gitDir.stdoutText.trim();

  if (trimmed === "") {
    return null;
  }

  return join(resolve(cwd, trimmed), STAMP_FILENAME);
}

function appendSection(hash: ReturnType<typeof createHash>, label: string, bytes: Uint8Array) {
  hash.update(`${label}\0${String(bytes.byteLength)}\0`);
  hash.update(bytes);
}

function appendUntrackedFiles(
  hash: ReturnType<typeof createHash>,
  repoRoot: string,
  rawPaths: Uint8Array,
) {
  const decoder = new TextDecoder();

  const paths = decoder
    .decode(rawPaths)
    .split("\0")
    .filter((entry) => entry !== "")
    .toSorted((left, right) => left.localeCompare(right));

  hash.update(`untracked-count\0${String(paths.length)}\0`);

  for (const relativePath of paths) {
    const fullPath = join(repoRoot, relativePath);

    try {
      const stat = lstatSync(fullPath);

      if (stat.isSymbolicLink()) {
        const target = readlinkSync(fullPath);

        hash.update(`symlink\0${relativePath}\0${target}\0`);
        continue;
      }

      if (stat.isFile()) {
        const contents = readFileSync(fullPath);

        hash.update(`file\0${relativePath}\0${String(contents.byteLength)}\0`);
        hash.update(contents);
        continue;
      }

      hash.update(`other\0${relativePath}\0${String(stat.mode)}\0`);
    } catch {
      hash.update(`missing\0${relativePath}\0`);
    }
  }
}

export function computeVerifyFingerprint(cwd: string) {
  const head = runGit(["rev-parse", "--verify", "HEAD"], cwd);

  if (head.exitCode !== 0) {
    return null;
  }

  const topLevel = runGit(["rev-parse", "--show-toplevel"], cwd);
  const repoRoot = topLevel.exitCode === 0 ? topLevel.stdoutText.trim() : cwd;

  const status = runGit(["status", "--porcelain=v1"], cwd);
  const stagedDiff = runGit(["diff", "--cached", "--binary"], cwd);
  const unstagedDiff = runGit(["diff", "--binary"], cwd);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd);

  if (
    status.exitCode !== 0 ||
    stagedDiff.exitCode !== 0 ||
    unstagedDiff.exitCode !== 0 ||
    untracked.exitCode !== 0
  ) {
    return null;
  }

  const hash = createHash("sha256");

  appendSection(hash, "head", new TextEncoder().encode(head.stdoutText.trim()));
  appendSection(hash, "status", status.stdoutBytes);
  appendSection(hash, "staged", stagedDiff.stdoutBytes);
  appendSection(hash, "unstaged", unstagedDiff.stdoutBytes);
  appendUntrackedFiles(hash, repoRoot, untracked.stdoutBytes);

  return hash.digest("hex");
}

export function writeVerifyStamp(cwd: string) {
  const stampPath = resolveVerifyStampPath(cwd);
  const fingerprint = computeVerifyFingerprint(cwd);

  if (stampPath === null || fingerprint === null) {
    return false;
  }

  const payload = {
    version: 1 as const,
    timestampSeconds: nowEpochSeconds(),
    fingerprint,
  };

  writeFileSync(stampPath, `${JSON.stringify(payload)}\n`, "utf8");

  return true;
}

export function clearVerifyStamp(cwd: string) {
  const stampPath = resolveVerifyStampPath(cwd);

  if (stampPath === null) {
    return;
  }

  rmSync(stampPath, { force: true });
}

export function isVerifyStampValid(cwd: string, maxAgeSeconds = STAMP_TTL_SECONDS) {
  const stampPath = resolveVerifyStampPath(cwd);

  if (stampPath === null || !existsSync(stampPath)) {
    return false;
  }

  try {
    const parsed = stampSchema.parse(JSON.parse(readFileSync(stampPath, "utf8")));
    const ageSeconds = nowEpochSeconds() - parsed.timestampSeconds;

    if (ageSeconds < 0 || ageSeconds >= maxAgeSeconds) {
      return false;
    }

    const currentFingerprint = computeVerifyFingerprint(cwd);

    return currentFingerprint !== null && currentFingerprint === parsed.fingerprint;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  if (process.argv.at(2) === "check") {
    process.exitCode = isVerifyStampValid(process.cwd()) ? 0 : 1;
  } else {
    process.stderr.write("usage: bun scripts/stamp.ts check\n");
    process.exitCode = 1;
  }
}
