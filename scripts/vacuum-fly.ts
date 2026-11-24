import { appendFileSync } from "node:fs";

import { z } from "zod";

import { createClock } from "../src/server/platform/ports/clock.ts";

const APP = "overture-web";
const DATABASE = "/data/app.sqlite";
const READY_FILE = "/tmp/vacuum-finished";
const OUTPUT_FILE = "/tmp/vacuum-output.txt";
const DEFAULT_THRESHOLD_MB = 50;
const HEALTH_URL = "https://tryoverture.com/api/health";
const HEALTH_ATTEMPTS = 24;

/** The longest the driver waits for the vacuum's ready file; the machine's keepalive must outlast it. */
export const READY_TIMEOUT_SECONDS = 20 * 60;
const READY_TIMEOUT_MS = READY_TIMEOUT_SECONDS * 1000;

/** The maintenance container's keepalive, longer than `READY_TIMEOUT_SECONDS` so Fly cannot stop it mid-vacuum. */
export const VACUUM_KEEPALIVE_SECONDS = 1500;

const clock = createClock();

const dryRunPattern =
  /file (?<file>[\d.]+) MB, WAL (?<wal>[\d.]+) MB, pages (?<pages>\d+) x (?<pageSize>\d+) B, freelist (?<freelist>\d+) pages \((?<free>[\d.]+) MB free\)/u;

const machineSchema = z.looseObject({
  config: z
    .looseObject({
      image: z.string().optional(),
      metadata: z.looseObject({ fly_process_group: z.string().optional() }).nullish(),
    })
    .nullish(),
  id: z.string(),
  name: z.string(),
  region: z.string().optional(),
  state: z.string(),
});

/** The sizes the database script's dry run prints, in the units it prints them. */
export interface DryRunSizes {
  fileMb: number;
  freeMb: number;
  freelistCount: number;
  pageCount: number;
  pageSizeBytes: number;
  walMb: number;
}

type Machine = z.infer<typeof machineSchema>;

function run(command: readonly string[], timeoutMs = 300_000) {
  process.stdout.write(`$ ${command.join(" ")}\n`);

  const result = Bun.spawnSync({
    cmd: [...command],
    stderr: "pipe",
    stdout: "pipe",
    timeout: timeoutMs,
  });

  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
    timedOut: result.exitedDueToTimeout === true,
  };
}

function runOrThrow(command: readonly string[], timeoutMs?: number) {
  const result = run(command, timeoutMs);

  if (result.timedOut) {
    throw new Error(`command timed out: ${command.join(" ")}\n${result.output}`);
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (exit ${String(result.exitCode)}): ${command.join(" ")}\n${result.output}`,
    );
  }

  return result;
}

/**
 * Reads the dry-run line `vacuum-app-db.ts` prints into its sizes.
 * @param output Everything the remote command wrote.
 * @returns The file, WAL, freelist and page sizes it reported.
 */
export function parseDryRunReport(output: string) {
  const match = dryRunPattern.exec(output);

  if (match?.groups === undefined) {
    throw new Error(`the dry run printed no size line to parse:\n${output}`);
  }

  const { file, free, freelist, pageSize, pages, wal } = match.groups;

  const sizes: DryRunSizes = {
    fileMb: Number(file),
    freeMb: Number(free),
    freelistCount: Number(freelist),
    pageCount: Number(pages),
    pageSizeBytes: Number(pageSize),
    walMb: Number(wal),
  };

  if (Object.values(sizes).some((value) => !Number.isFinite(value))) {
    throw new Error(`the dry run printed a size that is not a number:\n${output}`);
  }

  return sizes;
}

/**
 * Decides whether the file is worth compacting. Below the threshold the free pages are too few to pay for a
 * maintenance window; `force` overrides that, never the dry run.
 * @param sizes The dry run's sizes.
 * @param options The threshold in MB and whether an operator forced the run.
 * @returns `compact` or `skip`.
 */
export function compactionDecision(
  sizes: DryRunSizes,
  options: { force: boolean; thresholdMb: number },
) {
  if (options.force) {
    return "compact" as const;
  }

  return sizes.freeMb > options.thresholdMb ? ("compact" as const) : ("skip" as const);
}

function flagValue(name: string, fallback: number) {
  const flag = process.argv.slice(3).find((arg) => arg.startsWith(`--${name}=`));

  if (flag === undefined) {
    return fallback;
  }

  const value = Number(flag.slice(name.length + 3));

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function hasFlag(name: string) {
  return process.argv.slice(3).includes(`--${name}`);
}

function listMachines() {
  return z
    .array(machineSchema)
    .parse(JSON.parse(runOrThrow(["flyctl", "machines", "list", "-a", APP, "--json"]).output));
}

function productionMachine(machines: Machine[]) {
  const appMachines = machines.filter(
    (candidate) =>
      candidate.state === "started" && candidate.config?.metadata?.fly_process_group === "app",
  );

  const [machine] = appMachines;

  if (machine === undefined) {
    throw new Error(`no started app machine on ${APP}; nothing to inspect or compact`);
  }

  if (appMachines.length > 1) {
    throw new Error(
      `${APP} runs ${String(appMachines.length)} app machines, each on its own volume; compacting one would not reclaim the others`,
    );
  }

  if (machine.config?.image === undefined) {
    throw new Error(`the app machine ${machine.id} reports no image; refusing to touch it`);
  }

  return machine;
}

function setOutput(name: string, value: string) {
  const path = Bun.env.GITHUB_OUTPUT;

  if (path !== undefined && path.length > 0) {
    appendFileSync(path, `${name}=${value}\n`);
  }
}

function appendSummary(markdown: string) {
  const path = Bun.env.GITHUB_STEP_SUMMARY;

  if (path !== undefined && path.length > 0) {
    appendFileSync(path, markdown);
  }
}

function readDryRun(machineId: string) {
  const result = runOrThrow([
    "flyctl",
    "ssh",
    "console",
    "-a",
    APP,
    "--machine",
    machineId,
    "--command",
    `bun run /app/scripts/vacuum-app-db.ts ${DATABASE} --dry-run`,
  ]);

  return parseDryRunReport(result.output);
}

function assertMaintenanceSupport(machineId: string) {
  const probe = run([
    "flyctl",
    "ssh",
    "console",
    "-a",
    APP,
    "--machine",
    machineId,
    "--command",
    "sh -c 'grep -q VACUUM_ONLY /app/scripts/docker-entrypoint.sh && test -f /app/scripts/vacuum-app-db.ts'",
  ]);

  if (probe.exitCode !== 0) {
    throw new Error(
      `the release on ${APP} predates the vacuum maintenance mode; deploy the current main before compacting:\n${probe.output}`,
    );
  }
}

function checkPlan(force: boolean, thresholdMb: number) {
  const machine = productionMachine(listMachines());
  const sizes = readDryRun(machine.id);
  const decision = compactionDecision(sizes, { force, thresholdMb });

  process.stdout.write(
    `vacuum plan: file ${String(sizes.fileMb)} MB, WAL ${String(sizes.walMb)} MB, ` +
      `freelist ${String(sizes.freelistCount)} pages (${String(sizes.freeMb)} MB free); ` +
      `${decision === "compact" ? "compaction is needed" : `below the ${String(thresholdMb)} MB threshold`}\n`,
  );

  setOutput("free_mb", String(sizes.freeMb));
  setOutput("should_compact", decision === "compact" ? "true" : "false");
  appendSummary(
    `### Database vacuum\n\n` +
      `| Metric | Value |\n| --- | --- |\n` +
      `| File | ${String(sizes.fileMb)} MB |\n` +
      `| WAL | ${String(sizes.walMb)} MB |\n` +
      `| Freelist | ${String(sizes.freelistCount)} pages (${String(sizes.freeMb)} MB free) |\n` +
      `| Decision | ${decision === "compact" ? "compact" : `below the ${String(thresholdMb)} MB threshold, left alone`} |\n`,
  );

  return { decision, machine, sizes };
}

function waitForState(machineId: string, state: string) {
  runOrThrow([
    "flyctl",
    "machines",
    "wait",
    machineId,
    "-a",
    APP,
    "--state",
    state,
    "--wait-timeout",
    "10m",
  ]);
}

async function waitForHealth(attempt = 0) {
  const response = await fetch(HEALTH_URL).catch(() => null);

  if (response?.ok === true) {
    process.stdout.write(`health: ${HEALTH_URL} is ok\n`);

    return true;
  }

  if (attempt >= HEALTH_ATTEMPTS - 1) {
    return false;
  }

  await Bun.sleep(5000);

  return waitForHealth(attempt + 1);
}

async function waitForReady(machineId: string, deadline: number) {
  const probe = run(
    [
      "flyctl",
      "ssh",
      "console",
      "-a",
      APP,
      "--machine",
      machineId,
      "--command",
      `sh -c 'test -f ${READY_FILE}'`,
    ],
    60_000,
  );

  if (probe.exitCode === 0) {
    return;
  }

  if (clock.now() >= deadline) {
    throw new Error(
      `the vacuum did not finish within ${String(READY_TIMEOUT_SECONDS / 60)} minutes on ${machineId}; run ` +
        `"flyctl logs -a ${APP} --machine ${machineId}" for its output`,
    );
  }

  await Bun.sleep(5000);

  return waitForReady(machineId, deadline);
}

function readMaintenanceReport(machineId: string) {
  const { output } = runOrThrow([
    "flyctl",
    "ssh",
    "console",
    "-a",
    APP,
    "--machine",
    machineId,
    "--command",
    `sh -c 'cat ${OUTPUT_FILE}; exit $(cat ${READY_FILE})'`,
  ]);

  process.stdout.write(output);
}

/**
 * The `flyctl machines update` arguments that turn a machine into the vacuum container.
 *
 * `--yes` makes the destructive update non-interactive and the keepalive leaves the container running long enough
 * for the driver's ready-file wait, so Fly cannot stop it in the middle of a VACUUM.
 * @param machineId The app machine to switch into maintenance mode.
 * @returns The full command, including `flyctl`.
 */
export function maintenanceUpdateArgs(machineId: string) {
  return [
    "flyctl",
    "machines",
    "update",
    machineId,
    "-a",
    APP,
    "--env",
    "VACUUM_ONLY=true",
    "--env",
    `VACUUM_READY_FILE=${READY_FILE}`,
    "--env",
    `VACUUM_KEEPALIVE_SECONDS=${String(VACUUM_KEEPALIVE_SECONDS)}`,
    "--restart",
    "no",
    "--skip-health-checks",
    "--yes",
  ];
}

/**
 * The `flyctl machines update` arguments that put the app machine back on its image.
 * @param machineId The app machine to restore.
 * @returns The full command, including `flyctl`.
 */
export function restoreUpdateArgs(machineId: string) {
  return [
    "flyctl",
    "machines",
    "update",
    machineId,
    "-a",
    APP,
    "--env",
    "VACUUM_ONLY=false",
    "--restart",
    "on-failure",
    "--skip-health-checks",
    "--yes",
  ];
}

function restoreMachine(machineId: string) {
  runOrThrow(restoreUpdateArgs(machineId));
  waitForState(machineId, "started");
}

async function compact(machine: Machine) {
  let vacuumError: string | null = null;

  try {
    runOrThrow(maintenanceUpdateArgs(machine.id));

    waitForState(machine.id, "started");
    await waitForReady(machine.id, clock.now() + READY_TIMEOUT_MS);
    readMaintenanceReport(machine.id);

    process.stdout.write("vacuum finished; restarting the app server\n");
  } catch (error) {
    vacuumError = error instanceof Error ? error.message : String(error);
  }

  try {
    restoreMachine(machine.id);

    if (!(await waitForHealth())) {
      throw new Error(`the app did not answer ${HEALTH_URL} within 120 s after the vacuum`);
    }
  } catch (error) {
    const restoreError = error instanceof Error ? error.message : String(error);

    throw new Error(
      vacuumError === null
        ? `the app did not come back after the maintenance window: ${restoreError}`
        : `the vacuum failed (${vacuumError}) and the app did not come back: ${restoreError}`,
      { cause: error },
    );
  }

  if (vacuumError !== null) {
    throw new Error(`the vacuum failed: ${vacuumError}`);
  }
}

async function main() {
  const mode = z.enum(["plan", "compact"]).parse(process.argv[2]);
  const force = hasFlag("force");
  const thresholdMb = flagValue("threshold-mb", DEFAULT_THRESHOLD_MB);
  const plan = checkPlan(force, thresholdMb);

  if (mode === "plan") {
    return;
  }

  if (plan.decision === "skip") {
    process.stdout.write(
      "vacuum skipped: the file has too few free pages to justify the maintenance window\n",
    );

    return;
  }

  assertMaintenanceSupport(plan.machine.id);

  await compact(plan.machine);
}

if (import.meta.main) {
  await main();
}
