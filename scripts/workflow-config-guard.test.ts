import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findBunVersionDrift,
  findVacuumWorkflowProblems,
  readBunVersions,
  readWorkflowStep,
} from "./workflow-config-guard.ts";

const pinned = "1.4.5";

test("a workflow pinned to the package.json Bun version passes", () => {
  expect(
    findBunVersionDrift({
      pinned,
      workflows: [{ path: "ci.yml", versions: [pinned] }],
    }),
  ).toStrictEqual([]);
});

test("a workflow on latest is reported", () => {
  const problems = findBunVersionDrift({
    pinned,
    workflows: [{ path: "restore-drill.yml", versions: ["latest"] }],
  });

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("restore-drill.yml");
  expect(problems[0]).toContain("latest");
  expect(problems[0]).toContain(pinned);
});

test("one unpinned step among several pinned ones is reported", () => {
  const problems = findBunVersionDrift({
    pinned,
    workflows: [{ path: "ci.yml", versions: [pinned, "latest"] }],
  });

  expect(problems).toHaveLength(1);
});

test("a workflow that does not install Bun is ignored", () => {
  expect(
    findBunVersionDrift({ pinned, workflows: [{ path: "codeql.yml", versions: [] }] }),
  ).toStrictEqual([]);
});

test("readBunVersions reads every setup-bun pin in a workflow", () => {
  const source = [
    "      - uses: oven-sh/setup-bun@0123456",
    "        with:",
    "          bun-version: 1.4.5",
    "      - uses: oven-sh/setup-bun@0123456",
    "        with:",
    '          bun-version: "latest"',
  ].join("\n");

  expect(readBunVersions(source)).toStrictEqual(["1.4.5", "latest"]);
});

function readSeedStep() {
  return (
    readWorkflowStep(
      readFileSync(".github/workflows/ops-live.yml", "utf8"),
      "Seed the catalog and enqueue the backfill on overture-web",
    ) ?? ""
  );
}

test("readWorkflowStep slices one step and returns null for a missing name", () => {
  const source = [
    "      - name: one",
    "        run: |",
    "          echo one",
    "      - name: two",
  ].join("\n");

  expect(readWorkflowStep(source, "one")).toContain("echo one");
  expect(readWorkflowStep(source, "one")).not.toContain("name: two");
  expect(readWorkflowStep(source, "three")).toBeNull();
});

test("the catalog seed makes one bounded ssh call per command", () => {
  const step = readSeedStep();
  const script = step.slice(step.indexOf("run: |"));

  expect(script).not.toContain("&&");
  expect(step).toContain(
    'timeout "$duration" flyctl ssh console -a overture-web -C "$remote_command"',
  );
  expect(step).toContain('if [ "$status" -eq 124 ]');
  expect(step).toContain('if [ "$status" -ne 0 ]');
  expect(step.match(/run_ssh \d+s "/gu) ?? []).toHaveLength(5);
});

test("the catalog seed runs its five commands in order", () => {
  const labels = [...readSeedStep().matchAll(/^\s+run_ssh \d+s "(?<label>[^"]+)"/gmu)].map(
    (match) => match.groups?.label,
  );

  expect(labels).toStrictEqual([
    "create /data/seed",
    "chown /data/seed",
    "fetch-seed",
    "load-discovered-boards",
    "enqueue-backfill",
  ]);
});

test("every workflow pins the Bun version package.json requires", () => {
  const engine =
    /"bun":\s*"(?<version>[^"]+)"/u.exec(readFileSync("package.json", "utf8"))?.groups?.version ??
    "";

  expect(engine).not.toBe("");

  const workflows = [...new Bun.Glob("*.{yml,yaml}").scanSync(".github/workflows")].map((file) => ({
    path: file,
    versions: readBunVersions(readFileSync(join(".github/workflows", file), "utf8")),
  }));

  expect(findBunVersionDrift({ pinned: engine, workflows })).toStrictEqual([]);
});

function vacuumSources() {
  return {
    entrypoint: readFileSync("scripts/docker-entrypoint.sh", "utf8"),
    opsLive: readFileSync(".github/workflows/ops-live.yml", "utf8"),
    weekly: readFileSync(".github/workflows/vacuum-db.yml", "utf8"),
  };
}

test("the shipped vacuum workflows dry-run before they compact, behind a threshold", () => {
  expect(findVacuumWorkflowProblems(vacuumSources())).toStrictEqual([]);
});

test("a weekly vacuum that compacts before it dry-runs is reported", () => {
  const sources = vacuumSources();
  const planFirst = sources.weekly.indexOf("vacuum-fly.ts plan");
  const compactAt = sources.weekly.indexOf("vacuum-fly.ts compact");
  const reordered = `${sources.weekly.slice(0, planFirst)}${sources.weekly.slice(compactAt)}${sources.weekly.slice(planFirst, compactAt)}`;

  expect(
    findVacuumWorkflowProblems({ ...sources, weekly: reordered }).some((problem) =>
      problem.includes("dry-runs"),
    ),
  ).toBe(true);
});

test("a weekly vacuum without the Sunday schedule is reported", () => {
  const sources = vacuumSources();

  const problems = findVacuumWorkflowProblems({
    ...sources,
    weekly: sources.weekly.replace('cron: "0 5 * * 0"', 'cron: "0 5 * * 1"'),
  });

  expect(problems.some((problem) => problem.includes("Sundays"))).toBe(true);
});

test("a weekly vacuum that ignores its dry_run input is reported", () => {
  const sources = vacuumSources();

  const problems = findVacuumWorkflowProblems({
    ...sources,
    weekly: sources.weekly.replace("inputs.dry_run != 'true'", "inputs.force == 'true'"),
  });

  expect(problems.some((problem) => problem.includes("dry_run"))).toBe(true);
});

test("a maintenance entrypoint without --confirm is reported", () => {
  const sources = vacuumSources();

  const problems = findVacuumWorkflowProblems({
    ...sources,
    entrypoint: sources.entrypoint.replace("--confirm", "--dry-run"),
  });

  expect(problems.some((problem) => problem.includes("--confirm"))).toBe(true);
});
