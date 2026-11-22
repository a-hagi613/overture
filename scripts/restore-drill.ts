import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { countTableRows, verifyRestoredDatabase } from "../src/server/platform/db/restore-check.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";

const clock = createClock();

const [drillTargetArgument, flyAppNameArgument] = process.argv.slice(2);

const drillTarget = z.enum(["local", "fly"]).default("local").parse(drillTargetArgument);
const flyAppName = z.string().min(1).default("overture-web").parse(flyAppNameArgument);

const drillSecretNames = ["R2_DRILL_ACCESS_KEY_ID", "R2_DRILL_SECRET_ACCESS_KEY"] as const;

const ltxListingSchema = z.array(z.object({ max_txid: z.string(), timestamp: z.string() }));

const machineSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  state: z.string(),
  config: z
    .looseObject({
      image: z.string(),
      metadata: z.looseObject({ fly_process_group: z.string().optional() }).nullish(),
    })
    .nullish(),
});

function run(command: string[]) {
  process.stdout.write(`$ ${command.join(" ")}\n`);

  const result = Bun.spawnSync({ cmd: command, stdout: "pipe", stderr: "pipe" });

  return {
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
    exitCode: result.exitCode,
  };
}

function runOrThrow(command: string[]) {
  const result = run(command);

  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (exit ${String(result.exitCode)}): ${command.join(" ")}\n${result.output}`,
    );
  }

  return result;
}

function seedLiveDatabase(livePath: string) {
  const { db, sqlite } = openDatabase(livePath);

  migrateDatabase(db, "drizzle");

  const timestamp = clock.now();
  const stamp = Math.trunc(timestamp / 1000);
  const dueAt = timestamp - 60_000;

  sqlite
    .prepare("insert into users (id, name, email, created_at, updated_at) values (?, ?, ?, ?, ?)")
    .run("drill-user-1", "Drill One", "drill-1@example.com", stamp, stamp);
  sqlite
    .prepare("insert into users (id, name, email, created_at, updated_at) values (?, ?, ?, ?, ?)")
    .run("drill-user-2", "Drill Two", "drill-2@example.com", stamp, stamp);

  const dueJob = sqlite.prepare(
    "insert into bg_jobs (id, kind, payload, run_at, status, attempts, max_attempts, created_at, updated_at) values (?, ?, '{}', ?, 'queued', 0, 2, ?, ?)",
  );

  dueJob.run("drill-send", "application.send", dueAt, timestamp, timestamp);
  dueJob.run("drill-ready", "ready.notify", dueAt, timestamp, timestamp);
  dueJob.run("drill-billing", "billing.notice", dueAt, timestamp, timestamp);

  const counts = countTableRows(sqlite);

  sqlite.close();

  return counts;
}

async function drillLocal() {
  const work = "tmp/restore-drill";

  rmSync(work, { force: true, recursive: true });
  mkdirSync(work, { recursive: true });

  const livePath = join(work, "live.db");
  const restoredPath = join(work, "restored.db");
  const replicaPath = join(work, "replica");
  const configPath = join(work, "litestream.yml");

  const expectedCounts = seedLiveDatabase(livePath);

  await Bun.write(
    configPath,
    `dbs:\n  - path: ${livePath}\n    replicas:\n      - type: file\n        path: ${replicaPath}\n`,
  );

  runOrThrow(["litestream", "replicate", "-config", configPath, "-once", "-force-snapshot"]);

  const listing = ltxListingSchema.parse(
    JSON.parse(
      runOrThrow(["litestream", "ltx", "-json", "-level", "0", "-config", configPath, livePath])
        .output,
    ),
  );

  if (listing.length === 0) {
    throw new Error("the replica stores no replicated transactions");
  }

  runOrThrow(["litestream", "restore", "-config", configPath, "-o", restoredPath, livePath]);

  const report = verifyRestoredDatabase(restoredPath, {
    now: clock.now(),
    expectedRowCounts: expectedCounts,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (!report.ok) {
    throw new Error(`restored database checks failed: ${report.failures.join("; ")}`);
  }

  process.stdout.write(
    "restore drill passed: replica restored and checked read-only, with every due job left queued\n",
  );
}

function listMachines() {
  return z
    .array(machineSchema)
    .parse(
      JSON.parse(runOrThrow(["flyctl", "machines", "list", "-a", flyAppName, "--json"]).output),
    );
}

function assertDrillCredential() {
  const listed = runOrThrow(["flyctl", "secrets", "list", "-a", flyAppName]).output;
  const missing = drillSecretNames.filter((name) => !listed.includes(name));

  if (missing.length > 0) {
    throw new Error(
      `the restore drill needs the read-only R2 backup credential (docs/DEPLOY.md, "Restore drill safety"): set ${missing.join(" and ")} as Fly secrets on ${flyAppName}`,
    );
  }
}

function assertDeployedDrillSupport(machineId: string) {
  const probe = run([
    "flyctl",
    "ssh",
    "console",
    "-a",
    flyAppName,
    "--machine",
    machineId,
    "--command",
    "sh -c 'grep -q RESTORE_DRILL_READY_FILE /app/scripts/docker-entrypoint.sh && test -f /etc/litestream-drill.yml'",
  ]);

  if (probe.exitCode !== 0) {
    throw new Error(
      `the release running on ${flyAppName} predates the isolated restore drill (issue #412) and would start the app server; deploy the current main before drilling:\n${probe.output}`,
    );
  }
}

function machineLogs(machineId: string) {
  return run(["flyctl", "logs", "-a", flyAppName, "--machine", machineId, "--no-tail"]).output;
}

function machineGone(machineId: string) {
  return !listMachines().some((machine) => machine.id === machineId);
}

async function checkDrillMachine(drillId: string, command: string[], deadline: number) {
  const attempt = run(command);

  if (attempt.exitCode === 0) {
    process.stdout.write(attempt.output);

    return;
  }

  if (machineGone(drillId) || clock.now() >= deadline) {
    process.stderr.write(machineLogs(drillId));

    throw new Error(`the restored database check did not pass:\n${attempt.output}`);
  }

  process.stdout.write("the drill machine is not reachable yet, retrying the read-only check\n");
  await Bun.sleep(5000);
  await checkDrillMachine(drillId, command, deadline);
}

async function drillFly() {
  assertDrillCredential();

  const machines = listMachines().map((machine) => ({
    name: machine.name,
    id: machine.id,
    state: machine.state,
    image: machine.config?.image,
    processGroup: machine.config?.metadata?.fly_process_group,
  }));

  const production = machines.find(
    (machine) =>
      machine.image !== undefined &&
      machine.state === "started" &&
      machine.processGroup === "app" &&
      !machine.name.startsWith("restore-drill"),
  );

  if (production?.image === undefined) {
    throw new Error(`no started production machine found on ${flyAppName}`);
  }

  assertDeployedDrillSupport(production.id);

  const drillName = `restore-drill-${new Date(clock.now()).toISOString().replaceAll(/[-:.]/gu, "").toLowerCase()}`;
  const readyFile = "/tmp/restore-drill-checked";
  let drillId: string | undefined;

  try {
    runOrThrow([
      "flyctl",
      "machines",
      "run",
      production.image,
      "-a",
      flyAppName,
      "--name",
      drillName,
      "--region",
      "yyz",
      "--restart=no",
      "--rm",
      "--vm-size",
      "shared-cpu-1x",
      "--env",
      "LITESTREAM_RESTORE_ONLY=true",
      "--env",
      "LITESTREAM_CONFIG_PATH=/etc/litestream-drill.yml",
      "--env",
      "DATABASE_PATH=/data/app.sqlite",
      "--env",
      `RESTORE_DRILL_READY_FILE=${readyFile}`,
      "--detach",
    ]);

    const drill = listMachines().find((machine) => machine.name === drillName);

    if (drill === undefined) {
      throw new Error(`the drill machine ${drillName} was not created`);
    }

    drillId = drill.id;

    const started = run([
      "flyctl",
      "machines",
      "wait",
      drill.id,
      "-a",
      flyAppName,
      "--state",
      "started",
      "--wait-timeout",
      "10m",
    ]);

    if (started.exitCode !== 0) {
      process.stderr.write(machineLogs(drill.id));

      throw new Error(`the drill machine ${drillName} did not start:\n${started.output}`);
    }

    const check = [
      "flyctl",
      "ssh",
      "console",
      "-a",
      flyAppName,
      "--machine",
      drill.id,
      "--command",
      `sh -c 'i=0; while [ ! -f ${readyFile} ]; do i=$((i+1)); [ "$i" -ge 120 ] && exit 3; sleep 5; done; exec bun run /app/scripts/check-restored-db.ts /data/app.sqlite'`,
    ];

    const deadline = clock.now() + 1_200_000;

    await checkDrillMachine(drill.id, check, deadline);
  } finally {
    if (drillId !== undefined) {
      run(["flyctl", "machines", "destroy", drillId, "-a", flyAppName, "--force"]);
    }
  }

  process.stdout.write(
    "restore drill passed: throwaway machine restored and checked read-only, then destroyed; the app server never started\n",
  );
}

if (drillTarget === "local") {
  await drillLocal();
} else {
  await drillFly();
}
