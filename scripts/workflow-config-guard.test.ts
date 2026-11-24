import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findAdminHostWorkflowProblems,
  findBunVersionDrift,
  findRecoveryWorkflowProblems,
  findVacuumWorkflowProblems,
  findWorkersDeployProblems,
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
    weekly: sources.weekly.replace("!inputs.dry_run", "inputs.force == 'true'"),
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

function adminHostWorkflow() {
  return readFileSync(".github/workflows/ops-admin-host.yml", "utf8");
}

test("the shipped admin-host workflow is manual, bounded and secret-safe", () => {
  expect(findAdminHostWorkflowProblems({ workflow: adminHostWorkflow() })).toStrictEqual([]);
});

test("an admin-host workflow on an automatic trigger is reported", () => {
  const workflow = adminHostWorkflow().replace(
    "on:\n  workflow_dispatch:",
    "on:\n  push:\n  workflow_dispatch:",
  );

  expect(
    findAdminHostWorkflowProblems({ workflow }).some((problem) =>
      problem.includes("automatic trigger"),
    ),
  ).toBe(true);
});

test("an admin-host workflow without the FLY_API_TOKEN failure is reported", () => {
  const workflow = adminHostWorkflow().replace(
    "            exit 1\n          fi\n\n      - name: Add the certificate",
    "\n          fi\n\n      - name: Add the certificate",
  );

  expect(
    findAdminHostWorkflowProblems({ workflow }).some((problem) =>
      problem.includes("without FLY_API_TOKEN"),
    ),
  ).toBe(true);
});

test("an admin-host workflow that does not mask the Access AUD is reported", () => {
  const workflow = adminHostWorkflow().replace('          echo "::add-mask::$CF_ACCESS_AUD"\n', "");

  expect(
    findAdminHostWorkflowProblems({ workflow }).some((problem) =>
      problem.includes("mask CF_ACCESS_AUD"),
    ),
  ).toBe(true);
});

test("an admin-host workflow that prints a secret digest is reported", () => {
  const workflow = adminHostWorkflow().replace(
    '          flyctl secrets list -a overture-web --json > "$RUNNER_TEMP/secrets.json"',
    "          flyctl secrets list -a overture-web --json | jq -r '.[].Digest'",
  );

  expect(
    findAdminHostWorkflowProblems({ workflow }).some((problem) => problem.includes("digest")),
  ).toBe(true);
});

test("an admin-host workflow that sets Fly secrets outside the guarded action is reported", () => {
  const workflow = adminHostWorkflow().replace(
    "      - name: Refuse unless the Cloudflare Access values are repository secrets",
    "      - name: Set anyway\n        run: flyctl secrets set -a overture-web CF_ACCESS_AUD=x\n      - name: Refuse unless the Cloudflare Access values are repository secrets",
  );

  const problems = findAdminHostWorkflowProblems({ workflow });

  expect(problems.some((problem) => problem.includes("exactly one step"))).toBe(true);
  expect(problems.some((problem) => problem.includes("set-access-secrets guard"))).toBe(true);
});

test("an admin-host workflow that echoes an Access value is reported", () => {
  const workflow = adminHostWorkflow().replace(
    "          args=(",
    '          echo "$CF_ACCESS_AUD"\n          args=(',
  );

  expect(
    findAdminHostWorkflowProblems({ workflow }).some((problem) =>
      problem.includes("prints a Cloudflare Access value"),
    ),
  ).toBe(true);
});

test("an admin-host workflow without the set-access-secrets gate on the set step is reported", () => {
  const workflow = adminHostWorkflow().replace(
    "      - name: Set the Cloudflare Access secrets on overture-web\n        if: inputs.action == 'set-access-secrets'\n        env:",
    "      - name: Set the Cloudflare Access secrets on overture-web\n        env:",
  );

  expect(
    findAdminHostWorkflowProblems({ workflow }).some((problem) =>
      problem.includes("without the set-access-secrets guard"),
    ),
  ).toBe(true);
});

test("an admin-host workflow with an extra permission is reported", () => {
  const workflow = adminHostWorkflow().replace(
    "permissions:\n  contents: read",
    "permissions:\n  contents: read\n  issues: write",
  );

  expect(
    findAdminHostWorkflowProblems({ workflow }).some((problem) =>
      problem.includes("contents: read alone"),
    ),
  ).toBe(true);
});

test("an admin-host workflow that echoes a braced Access value is reported", () => {
  const dollar = "$";
  const braced = `${dollar}{CF_ACCESS_AUD}`;

  const workflow = adminHostWorkflow().replace(
    "          args=(",
    `          echo "${braced}"\n          args=(`,
  );

  expect(
    findAdminHostWorkflowProblems({ workflow }).some((problem) =>
      problem.includes("prints a Cloudflare Access value"),
    ),
  ).toBe(true);
});

function recoveryWorkflow() {
  return readFileSync(".github/workflows/ops-live.yml", "utf8");
}

const RESET_DIAGNOSTICS_STEP =
  "Show the overture-web status, volume and processes before a catalog reset";

const RESET_DELETE_STEP = "Delete only the catalog database files on the overture-web volume";

const SYNC_HEALTH_STEP = "Verify the production health route after the ops secrets sync";

test("the shipped recovery actions never touch the application database and never print a secret", () => {
  expect(findRecoveryWorkflowProblems({ opsLive: recoveryWorkflow() })).toStrictEqual([]);
});

test("an ops-live workflow without the recovery actions is reported", () => {
  const workflow = recoveryWorkflow().replace("          - reset-catalog\n", "");

  expect(
    findRecoveryWorkflowProblems({ opsLive: workflow }).some((problem) =>
      problem.includes("reset-catalog action"),
    ),
  ).toBe(true);
});

test("a catalog reset that deletes the application database is reported", () => {
  const workflow = recoveryWorkflow().replace(
    "/data/catalog.sqlite-journal",
    "/data/app.sqlite /data/catalog.sqlite-journal",
  );

  expect(
    findRecoveryWorkflowProblems({ opsLive: workflow }).some((problem) =>
      problem.includes("never touched"),
    ),
  ).toBe(true);
});

test("a catalog reset that shows no diagnostics first is reported", () => {
  const workflow = recoveryWorkflow();
  const diagnostics = readWorkflowStep(workflow, RESET_DIAGNOSTICS_STEP) ?? "";
  const withoutDiagnostics = workflow.replace(diagnostics, "");

  expect(
    findRecoveryWorkflowProblems({ opsLive: withoutDiagnostics }).some((problem) =>
      problem.includes("volume and processes first"),
    ),
  ).toBe(true);
});

test("a catalog reset that deletes before it shows the diagnostics is reported", () => {
  const workflow = recoveryWorkflow();
  const diagnostics = readWorkflowStep(workflow, RESET_DIAGNOSTICS_STEP) ?? "";
  const deletion = readWorkflowStep(workflow, RESET_DELETE_STEP) ?? "";

  const reordered = workflow
    .replace(diagnostics, "")
    .replace(deletion, `${deletion}${diagnostics}`);

  expect(
    findRecoveryWorkflowProblems({ opsLive: reordered }).some((problem) =>
      problem.includes("deletes before it shows the diagnostics"),
    ),
  ).toBe(true);
});

test("a catalog reset that kills Litestream is reported", () => {
  const workflow = recoveryWorkflow();

  const restart =
    readWorkflowStep(workflow, "Restart overture-web onto an empty catalog database") ?? "";

  const problems = findRecoveryWorkflowProblems({
    opsLive: workflow.replace(restart, `${restart}\n          pkill -9 -f litestream || true`),
  });

  expect(problems.some((problem) => problem.includes("kills Litestream"))).toBe(true);
});

test("a catalog reset that still calls ps aux is reported", () => {
  const workflow = recoveryWorkflow().replace(
    "for p in /proc/[0-9]*; do [ -r",
    "ps aux; for p in /proc/[0-9]*; do [ -r",
  );

  expect(
    findRecoveryWorkflowProblems({ opsLive: workflow }).some((problem) =>
      problem.includes("calls ps aux"),
    ),
  ).toBe(true);
});

test("a catalog reset that does not read the process list from /proc is reported", () => {
  const workflow = recoveryWorkflow();
  const diagnostics = readWorkflowStep(workflow, RESET_DIAGNOSTICS_STEP) ?? "";

  const problems = findRecoveryWorkflowProblems({
    opsLive: workflow.replace(diagnostics, diagnostics.replaceAll("/proc/", "/procX/")),
  });

  expect(problems.some((problem) => problem.includes("through /proc"))).toBe(true);
});

test("a catalog reset that still calls pkill is reported", () => {
  const workflow = recoveryWorkflow();

  const restart =
    readWorkflowStep(workflow, "Restart overture-web onto an empty catalog database") ?? "";

  const problems = findRecoveryWorkflowProblems({
    opsLive: workflow.replace(restart, `${restart}\n          pkill -9 bun || true`),
  });

  expect(problems.some((problem) => problem.includes("calls pkill"))).toBe(true);
});

test("a catalog reset that never scans /proc for the Bun child is reported", () => {
  const problems = findRecoveryWorkflowProblems({
    opsLive: recoveryWorkflow().replaceAll("/proc/", "/procX/"),
  });

  expect(
    problems.some((problem) => problem.includes("does not find the Bun child through /proc")),
  ).toBe(true);
});

test("an ops-secrets sync that does not mask a value is reported", () => {
  const workflow = recoveryWorkflow().replace('echo "::add-mask::$ALERT_NTFY_URL"\n', "");

  expect(
    findRecoveryWorkflowProblems({ opsLive: workflow }).some((problem) =>
      problem.includes("mask ALERT_NTFY_URL"),
    ),
  ).toBe(true);
});

test("an ops-secrets sync that prints a value is reported", () => {
  const workflow = recoveryWorkflow().replace(
    "          set_args=()",
    '          echo "$ALERT_NTFY_URL"\n          set_args=()',
  );

  expect(
    findRecoveryWorkflowProblems({ opsLive: workflow }).some((problem) =>
      problem.includes("prints a secret value"),
    ),
  ).toBe(true);
});

test("an ops-secrets sync that writes values into the step summary is reported", () => {
  const workflow = recoveryWorkflow().replace(
    `printf -- '- \`%s\`\\n' "\${key_names[@]}"`,
    `printf -- '- %s\\n' "\${set_args[@]}"`,
  );

  expect(
    findRecoveryWorkflowProblems({ opsLive: workflow }).some((problem) =>
      problem.includes("step summary"),
    ),
  ).toBe(true);
});

test("an ops-secrets sync that accepts an empty configuration is reported", () => {
  const workflow = recoveryWorkflow().replace(
    "::error::No secrets or flags were configured to sync.",
    "::notice::nothing to do",
  );

  expect(
    findRecoveryWorkflowProblems({ opsLive: workflow }).some((problem) =>
      problem.includes("refuse an empty sync"),
    ),
  ).toBe(true);
});

test("an ops-secrets sync without a health check is reported", () => {
  const workflow = recoveryWorkflow();
  const health = readWorkflowStep(workflow, SYNC_HEALTH_STEP) ?? "";

  expect(
    findRecoveryWorkflowProblems({ opsLive: workflow.replace(health, "") }).some((problem) =>
      problem.includes("does not verify the health route"),
    ),
  ).toBe(true);
});

function workersDeployWorkflow() {
  return readFileSync(".github/workflows/deploy.yml", "utf8");
}

test("the shipped deploy workflow ships the three Cloudflare Workers safely", () => {
  expect(findWorkersDeployProblems({ deploy: workersDeployWorkflow() })).toStrictEqual([]);
});

test("a deploy workflow without the deploy-workers job is reported", () => {
  const deploy = workersDeployWorkflow().replace("  deploy-workers:", "  deploy-workers-disabled:");

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) =>
      problem.includes("no deploy-workers job"),
    ),
  ).toBe(true);
});

test("a deploy workflow that skips a Worker is reported", () => {
  const deploy = workersDeployWorkflow().replace(
    "      - name: Deploy the sentinel Worker",
    "      - name: Deploy something else",
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) => problem.includes("workers/sentinel")),
  ).toBe(true);
});

test("a deploy workflow that drops --keep-vars on the inbound mail Worker is reported", () => {
  const deploy = workersDeployWorkflow();
  const step = readWorkflowStep(deploy, "Deploy the inbound mail Worker") ?? "";

  const problems = findWorkersDeployProblems({
    deploy: deploy.replace(
      step,
      step.replace("bunx wrangler deploy --keep-vars", "bunx wrangler deploy"),
    ),
  });

  expect(
    problems.some(
      (problem) => problem.includes("workers/inbound-mail") && problem.includes("--keep-vars"),
    ),
  ).toBe(true);
});

test("a deploy workflow that drops --keep-vars on the sentinel Worker is reported", () => {
  const deploy = workersDeployWorkflow();
  const step = readWorkflowStep(deploy, "Deploy the sentinel Worker") ?? "";

  const problems = findWorkersDeployProblems({
    deploy: deploy.replace(
      step,
      step.replace("bunx wrangler deploy --keep-vars", "bunx wrangler deploy"),
    ),
  });

  expect(
    problems.some(
      (problem) => problem.includes("workers/sentinel") && problem.includes("--keep-vars"),
    ),
  ).toBe(true);
});

test("a deploy workflow that deploys marketing before the build is reported", () => {
  const deploy = workersDeployWorkflow();
  const build = readWorkflowStep(deploy, "Build the marketing assets and app") ?? "";
  const withoutBuild = deploy.replace(build, "");

  const reordered = withoutBuild.replace(
    "      - name: Deploy the sentinel Worker",
    `${build}      - name: Deploy the sentinel Worker`,
  );

  expect(
    findWorkersDeployProblems({ deploy: reordered }).some((problem) =>
      problem.includes("before the build"),
    ),
  ).toBe(true);
});

test("a deploy workflow that prints the Cloudflare API token is reported", () => {
  const deploy = workersDeployWorkflow().replace(
    '          echo "::add-mask::$CLOUDFLARE_API_TOKEN"',
    '          echo "$CLOUDFLARE_API_TOKEN"',
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) =>
      problem.includes("prints the Cloudflare API token"),
    ),
  ).toBe(true);
});

test("a deploy workflow that does not check out the CI run's head SHA is reported", () => {
  const deploy = workersDeployWorkflow().replaceAll(
    "ref: ${{ github.event.workflow_run.head_sha }}",
    "ref: main",
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) => problem.includes("head SHA")),
  ).toBe(true);
});
