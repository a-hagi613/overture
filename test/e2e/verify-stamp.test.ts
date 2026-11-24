import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { z } from "zod";

const stampSchema = z.object({
  version: z.literal(1),
  timestampSeconds: z.number(),
  fingerprint: z.string().min(1),
});

function spawnWithLocalVerify(command: readonly string[], cwd: string, localVerify: "0" | "1") {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd,
    env: { ...process.env, OVERTURE_LOCAL_VERIFY: localVerify },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function runCommand(command: readonly string[], cwd: string) {
  return spawnWithLocalVerify(command, cwd, "1");
}

function runGit(args: readonly string[], cwd: string) {
  const output = runCommand(["git", ...args], cwd);

  if (output.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${output.stderr}`);
  }

  return output.stdout.trim();
}

function writeFixtureFiles(repoDir: string, runsLog: string) {
  const sourceRoot = process.cwd();

  mkdirSync(join(repoDir, ".githooks"), { recursive: true });
  mkdirSync(join(repoDir, "scripts"), { recursive: true });
  mkdirSync(join(repoDir, "src"), { recursive: true });

  copyFileSync(join(sourceRoot, ".githooks/pre-push"), join(repoDir, ".githooks/pre-push"));
  chmodSync(join(repoDir, ".githooks/pre-push"), 0o755);
  copyFileSync(join(sourceRoot, ".oxfmtrc.json"), join(repoDir, ".oxfmtrc.json"));
  copyFileSync(join(sourceRoot, "scripts/verify.ts"), join(repoDir, "scripts/verify.ts"));
  copyFileSync(join(sourceRoot, "scripts/stamp.ts"), join(repoDir, "scripts/stamp.ts"));

  const logScript = `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(runsLog)}, "run\\n");`;

  writeFileSync(
    join(repoDir, "package.json"),
    `${JSON.stringify(
      {
        name: "verify-stamp-fixture",
        private: true,
        type: "module",
        scripts: {
          verify: "bun run scripts/verify.ts",
          lint: `bun -e ${JSON.stringify(logScript)}`,
          "build:checked": 'bun -e ""',
          "lint:config": 'bun -e ""',
          "db:verify": 'bun -e ""',
        },
      },
      undefined,
      2,
    )}\n`,
  );

  writeFileSync(
    join(repoDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          types: ["bun"],
        },
        include: ["src/**/*.ts", "scripts/**/*.ts"],
      },
      undefined,
      2,
    )}\n`,
  );

  writeFileSync(join(repoDir, ".gitignore"), "node_modules\n");
  writeFileSync(join(repoDir, "src/ok.ts"), "export const value = 1;\n");
  writeFileSync(
    join(repoDir, "src/ok.test.ts"),
    'import { expect, test } from "bun:test";\n\ntest("ok", () => {\n  expect(1).toBe(1);\n});\n',
  );
}

function linkNodeModules(repoDir: string) {
  const linkPath = join(repoDir, "node_modules");

  if (!existsSync(linkPath)) {
    symlinkSync(join(process.cwd(), "node_modules"), linkPath, "dir");
  }
}

function createTempRepo() {
  const root = mkdtempSync(join(tmpdir(), "overture-verify-stamp-"));
  const remoteDir = join(root, "remote.git");
  const repoDir = join(root, "repo");
  const runsLog = join(root, "verify-runs.log");

  mkdirSync(remoteDir, { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(runsLog, "");

  runGit(["init", "--bare"], remoteDir);
  runGit(["init", "-b", "main"], repoDir);
  runGit(["config", "user.name", "Test User"], repoDir);
  runGit(["config", "user.email", "test@example.invalid"], repoDir);
  runGit(["config", "core.hooksPath", ".githooks"], repoDir);
  runGit(["remote", "add", "origin", remoteDir], repoDir);

  writeFixtureFiles(repoDir, runsLog);
  runCommand(["bun", "fmt"], repoDir);

  runGit(["add", "."], repoDir);
  runGit(["commit", "-m", "initial"], repoDir);
  linkNodeModules(repoDir);

  return { root, repoDir, remoteDir, runsLog };
}

function countRuns(runsLog: string) {
  const content = readFileSync(runsLog, "utf8").trim();

  if (content === "") {
    return 0;
  }

  return content.split("\n").length;
}

function gitDirOf(cwd: string) {
  return resolve(cwd, runGit(["rev-parse", "--git-dir"], cwd));
}

function pushAndExpectVerify(repoDir: string, runsLog: string, expectedRuns: number) {
  const push = runCommand(["git", "push", "origin", "HEAD:refs/heads/feature"], repoDir);

  expect(push.exitCode, `${push.stdout}${push.stderr}`).toBe(0);
  expect(`${push.stdout}${push.stderr}`).not.toContain("skipping duplicate run");
  expect(countRuns(runsLog)).toBe(expectedRuns);
}

test("pre-push skips duplicate verify when stamp matches HEAD and tree", () => {
  const fixture = createTempRepo();

  try {
    const verify = runCommand(["bun", "run", "verify"], fixture.repoDir);

    expect(verify.exitCode, `${verify.stdout}${verify.stderr}`).toBe(0);
    expect(countRuns(fixture.runsLog)).toBe(1);

    const stampFile = join(gitDirOf(fixture.repoDir), "verify-stamp");

    expect(existsSync(stampFile)).toBe(true);

    const push = runCommand(["git", "push", "origin", "HEAD:refs/heads/feature"], fixture.repoDir);

    expect(push.exitCode).toBe(0);
    expect(`${push.stdout}${push.stderr}`).toContain(
      "pre-push: verify stamp valid for HEAD + tree, skipping duplicate run",
    );
    expect(countRuns(fixture.runsLog)).toBe(1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("editing a file, adding an untracked file, committing, or expiring stamp re-runs verify", () => {
  const fixture = createTempRepo();

  try {
    expect(runCommand(["bun", "run", "verify"], fixture.repoDir).exitCode).toBe(0);
    expect(countRuns(fixture.runsLog)).toBe(1);

    writeFileSync(join(fixture.repoDir, "src/ok.ts"), "export const value = 2;\n");
    pushAndExpectVerify(fixture.repoDir, fixture.runsLog, 2);

    writeFileSync(join(fixture.repoDir, "src/untracked.ts"), "export const extra = 1;\n");
    pushAndExpectVerify(fixture.repoDir, fixture.runsLog, 3);

    writeFileSync(join(fixture.repoDir, "src/untracked.ts"), "export const extra = 2;\n");
    pushAndExpectVerify(fixture.repoDir, fixture.runsLog, 4);

    runGit(["add", "src/ok.ts", "src/untracked.ts"], fixture.repoDir);
    runGit(["commit", "-m", "second"], fixture.repoDir);
    pushAndExpectVerify(fixture.repoDir, fixture.runsLog, 5);

    const stampFile = join(gitDirOf(fixture.repoDir), "verify-stamp");
    const current = stampSchema.parse(JSON.parse(readFileSync(stampFile, "utf8")));

    writeFileSync(
      stampFile,
      `${JSON.stringify({ ...current, timestampSeconds: current.timestampSeconds - 1801 })}\n`,
    );
    pushAndExpectVerify(fixture.repoDir, fixture.runsLog, 6);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("deleting a remote ref skips verify even without a stamp", () => {
  const fixture = createTempRepo();

  try {
    expect(
      runCommand(["git", "push", "origin", "HEAD:refs/heads/to-delete"], fixture.repoDir).exitCode,
    ).toBe(0);
    expect(countRuns(fixture.runsLog)).toBe(1);

    rmSync(join(gitDirOf(fixture.repoDir), "verify-stamp"), { force: true });

    const deletePush = runCommand(
      ["git", "push", "origin", "--delete", "to-delete"],
      fixture.repoDir,
    );

    expect(deletePush.exitCode).toBe(0);
    expect(countRuns(fixture.runsLog)).toBe(1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("git worktrees store and check verify-stamp inside their own git-dir", () => {
  const fixture = createTempRepo();
  const worktreeDir = join(fixture.root, "wt-child");

  try {
    runGit(["worktree", "add", "-b", "wt-branch", worktreeDir], fixture.repoDir);
    linkNodeModules(worktreeDir);

    const verifyWorktree = runCommand(["bun", "run", "verify"], worktreeDir);

    expect(verifyWorktree.exitCode, `${verifyWorktree.stdout}${verifyWorktree.stderr}`).toBe(0);
    expect(countRuns(fixture.runsLog)).toBe(1);
    expect(existsSync(join(gitDirOf(worktreeDir), "verify-stamp"))).toBe(true);
    expect(existsSync(join(gitDirOf(fixture.repoDir), "verify-stamp"))).toBe(false);

    const pushWorktree = runCommand(
      ["git", "push", "origin", "HEAD:refs/heads/wt-branch"],
      worktreeDir,
    );

    expect(pushWorktree.exitCode).toBe(0);
    expect(`${pushWorktree.stdout}${pushWorktree.stderr}`).toContain(
      "pre-push: verify stamp valid for HEAD + tree, skipping duplicate run",
    );
    expect(countRuns(fixture.runsLog)).toBe(1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("failed verify clears any existing stamp and does not write a new one", () => {
  const fixture = createTempRepo();

  try {
    const initial = runCommand(["bun", "run", "verify"], fixture.repoDir);

    expect(initial.exitCode, `${initial.stdout}${initial.stderr}`).toBe(0);

    const stampFile = join(gitDirOf(fixture.repoDir), "verify-stamp");

    expect(existsSync(stampFile)).toBe(true);

    writeFileSync(join(fixture.repoDir, "src/ok.ts"), "export const value: number = 'bad';\n");

    const failed = runCommand(["bun", "run", "verify"], fixture.repoDir);

    expect(failed.exitCode).not.toBe(0);
    expect(existsSync(stampFile)).toBe(false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("default pre-push runs format check and defers full verify to CI", () => {
  const fixture = createTempRepo();

  try {
    const cleanPush = spawnWithLocalVerify(
      ["git", "push", "origin", "HEAD:refs/heads/feature"],
      fixture.repoDir,
      "0",
    );

    expect(cleanPush.exitCode, `${cleanPush.stdout}${cleanPush.stderr}`).toBe(0);
    expect(`${cleanPush.stdout}${cleanPush.stderr}`).toContain(
      "pre-push: format ok; full verify deferred to GitHub Actions gate",
    );
    expect(countRuns(fixture.runsLog)).toBe(0);

    writeFileSync(join(fixture.repoDir, "src/ok.ts"), "export const   value=2;\n");

    const dirtyPush = spawnWithLocalVerify(
      ["git", "push", "origin", "HEAD:refs/heads/feature"],
      fixture.repoDir,
      "0",
    );

    expect(dirtyPush.exitCode).not.toBe(0);
    expect(countRuns(fixture.runsLog)).toBe(0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
