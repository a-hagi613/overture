import { spawnSync } from "node:child_process";

import { z } from "zod";

const spanSchema = z.object({ line: z.number(), column: z.number() });

const diagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  filename: z.string(),
  labels: z.array(z.object({ span: spanSchema })).default([]),
});

type Diagnostic = z.infer<typeof diagnosticSchema>;

const reportSchema = z.object({ diagnostics: z.array(diagnosticSchema) });

function run(binary: string, args: string[]) {
  const result = spawnSync(binary, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  return result;
}

function findingsOf(binary: string, args: string[]) {
  const result = run(binary, args);

  try {
    return reportSchema.parse(JSON.parse(result.stdout)).diagnostics;
  } catch {
    return null;
  }
}

function keyOf(diagnostic: Diagnostic) {
  const span = diagnostic.labels[0]?.span;

  return `${diagnostic.filename}:${String(span?.line ?? 0)}:${String(span?.column ?? 0)} ${diagnostic.code}`;
}

function versionOf(binary: string) {
  return run(binary, ["--version"]).stdout.trim();
}

function compare() {
  const oxlint = findingsOf("bunx", ["oxlint", "--format=json"]);
  const native = findingsOf(process.execPath, ["lint", "--no-script", "--format=json"]);

  if (oxlint === null) {
    process.stderr.write("lint:parity could not read oxlint findings\n");
    process.exitCode = 1;

    return;
  }

  process.stdout.write(`oxlint: ${String(oxlint.length)} findings\n`);

  if (native === null) {
    process.stdout.write(
      `native bun lint: unavailable in Bun ${versionOf(process.execPath)}; run this script with a canary Bun to compare\n`,
    );

    return;
  }

  process.stdout.write(
    `native bun lint (Bun ${versionOf(process.execPath)}): ${String(native.length)} findings\n`,
  );

  const oxlintKeys = new Set(oxlint.map((diagnostic) => keyOf(diagnostic)));
  const nativeKeys = new Set(native.map((diagnostic) => keyOf(diagnostic)));

  const missing = [...oxlintKeys].filter((key) => !nativeKeys.has(key)).toSorted();
  const extra = [...nativeKeys].filter((key) => !oxlintKeys.has(key)).toSorted();

  if (missing.length === 0 && extra.length === 0) {
    process.stdout.write("lint:parity identical findings\n");

    return;
  }

  process.stdout.write(
    `lint:parity ${String(missing.length + extra.length)} differences (${String(missing.length)} missing, ${String(extra.length)} extra)\n`,
  );

  for (const key of missing.slice(0, 50)) {
    process.stdout.write(`  oxlint only: ${key}\n`);
  }

  for (const key of extra.slice(0, 50)) {
    process.stdout.write(`  native only: ${key}\n`);
  }
}

compare();
