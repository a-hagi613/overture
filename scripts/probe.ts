import { existsSync } from "node:fs";
import { stdin, stdout } from "node:process";

import { databasePath, env } from "../src/server/config/env.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { createStreamConsole } from "../src/server/probe/console.ts";
import type { RunFile } from "../src/server/probe/run-file.ts";
import { runFileSchema } from "../src/server/probe/run-file.ts";
import { runProbe } from "../src/server/probe/run-probe.ts";

const args = Bun.argv.slice(2);
const runFileFlag = args.indexOf("--run-file");

async function main() {
  if (runFileFlag === -1) {
    process.stderr.write("usage: bun run scripts/probe.ts --run-file <path> [--confirm]\n");
    process.exitCode = 1;

    return;
  }

  const runFilePath = args[runFileFlag + 1];

  if (runFilePath === undefined) {
    process.stderr.write("usage: bun run scripts/probe.ts --run-file <path> [--confirm]\n");
    process.exitCode = 1;

    return;
  }

  if (env.FLY_APP_NAME === undefined && env.FLY_MACHINE_ID === undefined) {
    process.stderr.write(
      "refusing: the probe runs only on overture-web through `fly ssh console`, never from a development machine\n",
    );
    process.exitCode = 1;

    return;
  }

  if (env.BROWSER_USE_API_KEY === undefined) {
    process.stderr.write("refusing: BROWSER_USE_API_KEY is not set\n");
    process.exitCode = 1;

    return;
  }

  if (!existsSync(runFilePath)) {
    process.stderr.write(`refusing: the run file ${runFilePath} does not exist\n`);
    process.exitCode = 1;

    return;
  }

  let runFile: RunFile;

  try {
    runFile = runFileSchema.parse(JSON.parse(await Bun.file(runFilePath).text()));
  } catch (error) {
    process.stderr.write(`refusing: ${runFilePath} is not a valid run file: ${String(error)}\n`);
    process.exitCode = 1;

    return;
  }

  if (!existsSync(runFile.resumePath)) {
    process.stderr.write(
      `refusing: the resume file ${runFile.resumePath} does not exist on this machine\n`,
    );
    process.exitCode = 1;

    return;
  }

  const io = createStreamConsole(stdin, stdout);

  const results = await runProbe({
    runFile,
    confirm: args.includes("--confirm"),
    apiKey: env.BROWSER_USE_API_KEY,
    apiBaseUrl: env.BROWSER_USE_API_BASE_URL,
    databasePath,
    flyAppName: env.FLY_APP_NAME,
    flyMachineId: env.FLY_MACHINE_ID,
    postingUrlOrigin: undefined,
    clock: createClock(),
    console: io,
  });

  io.close();

  if (results.some((result) => !result.submitted)) {
    process.exitCode = 1;
  }
}

await main();
