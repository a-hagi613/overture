const checks = [
  ["lint", ["bun", "run", "lint"]],
  ["format", ["bun", "fmt", "--check"]],
  ["typecheck", ["bun", "check"]],
  ["unit", ["bun", "test", "src"]],
  ["build", ["bun", "run", "build"]],
  ["lint-config", ["bun", "run", "lint:config"]],
  ["db", ["bun", "run", "db:verify"]],
] as const;

async function runCheck(name: string, command: readonly string[]) {
  const started = performance.now();

  const child = Bun.spawn({
    cmd: [...command],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { name, exitCode, stdout, stderr, seconds: (performance.now() - started) / 1000 };
}

const started = performance.now();

const results = await Promise.all(
  checks.map(async ([name, command]) => {
    const result = await runCheck(name, command);

    return result;
  }),
);

const total = (performance.now() - started) / 1000;

process.stdout.write(`verify: ${String(checks.length)} checks in ${total.toFixed(1)}s\n`);

for (const result of results) {
  const status = result.exitCode === 0 ? "ok" : "FAILED";

  process.stdout.write(
    `  ${status.padEnd(6)} ${result.name.padEnd(11)} ${result.seconds.toFixed(1)}s\n`,
  );

  if (result.exitCode !== 0) {
    process.stdout.write(`${result.stdout}${result.stderr}`);
  }
}

const failed = results.filter((result) => result.exitCode !== 0);

process.stdout.write(
  `verify: ${String(results.length - failed.length)} passed, ${String(failed.length)} failed\n`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
