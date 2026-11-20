import type { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";

const clock = createClock();

const [drillTargetArgument, flyAppNameArgument] = process.argv.slice(2);

const drillTarget = z.enum(["local", "fly"]).default("local").parse(drillTargetArgument);
const flyAppName = z.string().min(1).default("overture-web").parse(flyAppNameArgument);

const countSchema = z.object({ n: z.number() });
const tableNamesSchema = z.array(z.object({ name: z.string() }));
const integritySchema = z.object({ integrity_check: z.string() });
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

function rowCounts(sqlite: Database) {
  const names = tableNamesSchema
    .parse(
      sqlite
        .query(
          "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle_%'",
        )
        .all(),
    )
    .map((table) => table.name);

  return Object.fromEntries(
    names.map((name) => [
      name,
      countSchema.parse(sqlite.query(`select count(*) as n from "${name}"`).get()).n,
    ]),
  );
}

function seedLiveDatabase(livePath: string) {
  const { db, sqlite } = openDatabase(livePath);

  migrateDatabase(db, "drizzle");

  const timestamp = clock.now();

  sqlite
    .prepare("insert into users (id, email, created_at) values (?, ?, ?)")
    .run("drill-user-1", "drill-1@example.com", timestamp);
  sqlite
    .prepare("insert into users (id, email, created_at) values (?, ?, ?)")
    .run("drill-user-2", "drill-2@example.com", timestamp);
  sqlite
    .prepare(
      "insert into bg_jobs (id, kind, payload, run_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    )
    .run("drill-job-1", "drill", "{}", timestamp, timestamp, timestamp);

  const counts = rowCounts(sqlite);

  sqlite.close();

  return counts;
}

function checkRestoredDatabase(restoredPath: string, expectedCounts: Record<string, number>) {
  const { sqlite } = openDatabase(restoredPath);

  try {
    const integrity = integritySchema.parse(
      sqlite.query("pragma integrity_check").get(),
    ).integrity_check;

    const migrations = countSchema.parse(
      sqlite.query("select count(*) as n from __drizzle_migrations").get(),
    ).n;

    const counts = rowCounts(sqlite);

    if (integrity !== "ok") {
      throw new Error(`restored database integrity_check returned ${integrity}`);
    }

    if (migrations === 0) {
      throw new Error("restored database has no applied migrations");
    }

    for (const [name, expected] of Object.entries(expectedCounts)) {
      const actual = counts[name];

      if (actual === undefined || actual !== expected) {
        throw new Error(
          `table ${name} has ${String(actual ?? "no")} restored rows, expected ${String(expected)}`,
        );
      }
    }

    process.stdout.write(
      `restored database checks passed: integrity ok, ${String(migrations)} migrations, ${String(Object.keys(counts).length)} tables match\n`,
    );
  } finally {
    sqlite.close();
  }
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

  checkRestoredDatabase(restoredPath, expectedCounts);
}

function listMachines() {
  return z
    .array(machineSchema)
    .parse(
      JSON.parse(runOrThrow(["flyctl", "machines", "list", "-a", flyAppName, "--json"]).output),
    );
}

function drillFly() {
  const machines = listMachines().map((machine) => ({
    name: machine.name,
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

  const drillName = `restore-drill-${new Date(clock.now()).toISOString().replaceAll(/[-:.]/gu, "").toLowerCase()}`;
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
      "DATABASE_PATH=/data/app.sqlite",
      "--detach",
    ]);

    const drill = listMachines().find((machine) => machine.name === drillName);

    if (drill === undefined) {
      throw new Error(`the drill machine ${drillName} was not created`);
    }

    drillId = drill.id;

    runOrThrow([
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

    const check = runOrThrow([
      "flyctl",
      "ssh",
      "console",
      "-a",
      flyAppName,
      "--machine",
      drill.id,
      "--command",
      "bun run scripts/check-restored-db.ts /data/app.sqlite http://127.0.0.1:3000/api/health",
    ]);

    process.stdout.write(check.output);
  } finally {
    if (drillId !== undefined) {
      run(["flyctl", "machines", "destroy", drillId, "-a", flyAppName, "--force"]);
    }
  }

  process.stdout.write("restore drill passed: throwaway machine restored, checked and destroyed\n");
}

if (drillTarget === "local") {
  await drillLocal();
} else {
  drillFly();
}
