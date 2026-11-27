import { afterEach, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  MARKETING_SYNC_FIXTURES,
  marketingSyncSandbox,
  marketingSyncScript,
  removeMarketingSyncSandboxes,
  snapshotTree,
} from "./fly-marketing-sync-sandbox.ts";
import {
  findAdminHostWorkflowProblems,
  findBunVersionDrift,
  findFreehireLaunchSecretProblems,
  findRecoveryWorkflowProblems,
  findScheduledSpendProblems,
  findVacuumWorkflowProblems,
  findWorkersDeployProblems,
  flyctlRemoteCommands,
  MARKETING_POST_DEPLOY_VERIFY_STEP,
  MARKETING_PRE_DEPLOY_VERIFY_STEP,
  MARKETING_SYNC_STEP,
  readBunVersions,
  readWorkflowStep,
} from "./workflow-config-guard.ts";
import {
  deploySecretGateScript,
  launchSecretSandbox,
  opsSecretSyncScript,
  removeLaunchSecretSandboxes,
  REQUIRED_FLY_SECRETS,
} from "./launch-secret-sandbox.ts";

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

function workflowSources() {
  return [...new Bun.Glob("*.{yml,yaml}").scanSync(".github/workflows")].toSorted().map((file) => ({
    path: file,
    source: readFileSync(join(".github/workflows", file), "utf8"),
  }));
}

function envLine(name: string) {
  return `          ${name}: \${{ secrets.${name} }}`;
}

function scheduledWorkflow(envLines: readonly string[]) {
  return [
    "name: Example",
    "",
    "on:",
    "  schedule:",
    '    - cron: "0 6 * * *"',
    "  workflow_dispatch:",
    "",
    "jobs:",
    "  spend:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Run",
    "        env:",
    ...envLines,
    "        run: bun run scripts/example.ts",
  ].join("\n");
}

test("no automatic workflow passes a secret that spends real money", () => {
  expect(findScheduledSpendProblems({ workflows: workflowSources() })).toStrictEqual([]);
});

test("a scheduled workflow that passes a Browser Use key is reported", () => {
  const problems = findScheduledSpendProblems({
    workflows: [
      {
        path: "nightly.yml",
        source: scheduledWorkflow([envLine("BROWSER_USE_API_KEY")]),
      },
    ],
  });

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(".github/workflows/nightly.yml");
  expect(problems[0]).toContain("schedule");
  expect(problems[0]).toContain("BROWSER_USE_API_KEY");
  expect(problems[0]).toContain("job spend");
  expect(problems[0]).toContain("allow-list");
});

test("a workflow that spends on every push is reported, not only a cron one", () => {
  const problems = findScheduledSpendProblems({
    workflows: [
      {
        path: "ci-spend.yml",
        source: [
          "name: CI spend",
          "",
          "on:",
          "  pull_request:",
          "",
          "jobs:",
          "  gate:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: bun run scripts/spend.ts",
          "        env:",
          envLine("ANTHROPIC_API_KEY"),
        ].join("\n"),
      },
    ],
  });

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("pull_request");
  expect(problems[0]).toContain("ANTHROPIC_API_KEY");
});

test("an inline or scalar on: trigger is read as automatic", () => {
  const inline = findScheduledSpendProblems({
    workflows: [
      {
        path: "inline.yml",
        source: [
          "on: [push, workflow_dispatch]",
          "jobs:",
          "  gate:",
          "    steps:",
          "      - env:",
          envLine("FREEHIRE_API_KEY"),
        ].join("\n"),
      },
    ],
  });

  expect(inline).toHaveLength(1);
  expect(inline[0]).toContain("push");

  const scalar = findScheduledSpendProblems({
    workflows: [
      {
        path: "scalar.yml",
        source: [
          "on: schedule",
          "jobs:",
          "  gate:",
          "    steps:",
          "      - env:",
          envLine("GEMINI_API_KEY"),
        ].join("\n"),
      },
    ],
  });

  expect(scalar).toHaveLength(1);
  expect(scalar[0]).toContain("schedule");
});

test("a workflow_dispatch-only tool may read a spend secret", () => {
  const problems = findScheduledSpendProblems({
    workflows: [
      {
        path: "ops.yml",
        source: [
          "name: Ops",
          "",
          "on:",
          "  workflow_dispatch:",
          "",
          "jobs:",
          "  run:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: bun run scripts/live.ts",
          "        env:",
          envLine("FREEHIRE_API_KEY"),
        ].join("\n"),
      },
    ],
  });

  expect(problems).toStrictEqual([]);
});

test("an allow-list entry permits exactly the secret it names", () => {
  const source = scheduledWorkflow([envLine("ANTHROPIC_API_KEY"), envLine("GEMINI_API_KEY")]);

  const allow = [
    {
      workflow: "nightly.yml",
      secrets: ["ANTHROPIC_API_KEY"],
      reason: "the owner approved one nightly scoring pass",
    },
  ];

  const problems = findScheduledSpendProblems({
    workflows: [{ path: "nightly.yml", source }],
    allow,
  });

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("GEMINI_API_KEY");
});

test("an allow-list entry that outlived its secret is reported as stale", () => {
  const problems = findScheduledSpendProblems({
    workflows: [{ path: "nightly.yml", source: scheduledWorkflow([]) }],
    allow: [
      {
        workflow: "nightly.yml",
        secrets: ["BROWSER_USE_API_KEY"],
        reason: "the workflow used to fill forms nightly",
      },
    ],
  });

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("stale");
  expect(problems[0]).toContain("BROWSER_USE_API_KEY");
});

test("an allow-list entry for a workflow that no longer exists is reported", () => {
  const problems = findScheduledSpendProblems({
    workflows: [{ path: "nightly.yml", source: scheduledWorkflow([]) }],
    allow: [
      {
        workflow: "deleted.yml",
        secrets: ["ANTHROPIC_API_KEY"],
        reason: "the workflow was removed",
      },
    ],
  });

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("deleted.yml");
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

const DOLLAR_SIGN = "$";

function variableReference(name: string) {
  return `${name}: ${DOLLAR_SIGN}{{ vars.${name} }}`;
}

function secretReference(name: string) {
  return `${name}: ${DOLLAR_SIGN}{{ secrets.${name} }}`;
}

function workersStepBlock(source: string, name: string) {
  const marker = `      - name: ${name}`;
  const start = source.indexOf(marker);

  if (start === -1) {
    return "";
  }

  const rest = source.slice(start + marker.length);
  const end = rest.search(/^ {6}- /mu);

  return end === -1 ? source.slice(start) : source.slice(start, start + marker.length + end);
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

test("a deploy workflow that rebuilds the marketing assets instead of syncing them is reported", () => {
  const deploy = workersDeployWorkflow().replace(
    "      - name: Sync dist-marketing from the deployed overture-web machine",
    "      - name: Build the marketing assets and app",
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) => problem.includes("bun run build")),
  ).toBe(false);

  const rebuilding = deploy.replace(
    "        run: |\n          set -euo pipefail\n          rm -rf dist-marketing",
    "        run: bun run build\n          set -euo pipefail\n          rm -rf dist-marketing",
  );

  expect(
    findWorkersDeployProblems({ deploy: rebuilding }).some(
      (problem) => problem.includes("bun run build") && problem.includes("/assets/main-*.js"),
    ),
  ).toBe(true);
});

test("a deploy workflow that does not sync dist-marketing from Fly is reported", () => {
  const deploy = workersDeployWorkflow().replace(
    `      - name: ${MARKETING_SYNC_STEP}`,
    "      - name: Copy the marketing directory",
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) =>
      problem.includes("does not sync dist-marketing from the deployed Fly machine"),
    ),
  ).toBe(true);
});

test("a sync that can continue without the extracted page is reported", () => {
  const deploy = workersDeployWorkflow();
  const sync = readWorkflowStep(deploy, MARKETING_SYNC_STEP) ?? "";

  expect(sync).not.toBe("");

  const withoutFailLoud = deploy.replace(sync, sync.replaceAll("exit 1", "true"));

  expect(
    findWorkersDeployProblems({ deploy: withoutFailLoud }).some((problem) =>
      problem.includes("stale HTML could ship"),
    ),
  ).toBe(true);
});

test("a deploy workflow that skips the flyctl setup cannot extract the page and is reported", () => {
  const deploy = workersDeployWorkflow().replaceAll(
    "superfly/flyctl-actions/setup-flyctl@98172f70657cb3e15db199af139be99bd3e61200",
    "superfly/flyctl-actions/setup-flyctl@master",
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) =>
      problem.includes("does not set up flyctl"),
    ),
  ).toBe(true);
});

test("a deploy workflow that drops -q from flyctl ssh console is reported", () => {
  const deploy = workersDeployWorkflow().replace(
    "flyctl ssh console -q -a overture-web",
    "flyctl ssh console -a overture-web",
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) => problem.includes("without -q")),
  ).toBe(true);
});

test("a deploy workflow that drops the sentinel framing around the archive is reported", () => {
  const deploy = workersDeployWorkflow().replaceAll("OVERTURE-TAR-BEGIN", "unframed");
  const problems = findWorkersDeployProblems({ deploy });

  expect(problems.some((problem) => problem.includes("sentinel markers"))).toBe(true);

  expect(
    findWorkersDeployProblems({
      deploy: workersDeployWorkflow().replaceAll("OVERTURE-TAR-END", "unframed"),
    }).some((problem) => problem.includes("sentinel markers")),
  ).toBe(true);
});

test("a deploy workflow that stops decoding the base64 archive is reported", () => {
  const deploy = workersDeployWorkflow().replace("| base64 -d | tar -xzf -", "| tar -xzf -");

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) =>
      problem.includes("binary-safe extraction"),
    ),
  ).toBe(true);
});

test("a deploy workflow that pipes flyctl straight into tar is reported", () => {
  const deploy = workersDeployWorkflow().replace(
    '          archive="$(mktemp)"',
    `          archive="$(mktemp)"
          flyctl ssh console -q -a overture-web -C "tar -czf - -C /app dist-marketing" | tar -xzf -`,
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) =>
      problem.includes("pipes flyctl stdout straight into tar"),
    ),
  ).toBe(true);
});

test("a deploy workflow that passes the multi-statement extraction to flyctl without sh -c is reported", () => {
  const deploy = workersDeployWorkflow();
  const step = readWorkflowStep(deploy, MARKETING_SYNC_STEP) ?? "";
  const [remote] = flyctlRemoteCommands(step);

  expect(remote?.startsWith("sh -c '")).toBe(true);

  const unwrapped = `printf '%s\\n' '\${begin_marker}'; tar -czf - -C /app dist-marketing | base64; printf '%s\\n' '\${end_marker}'`;

  expect(
    findWorkersDeployProblems({ deploy: deploy.replace(remote ?? "", unwrapped) }).some((problem) =>
      problem.includes("wrap the remote command in sh -c"),
    ),
  ).toBe(true);

  const stripped = (remote ?? "").slice("sh -c '".length, -1);

  expect(stripped).toContain(";");
  expect(
    findWorkersDeployProblems({ deploy: deploy.replace(remote ?? "", stripped) }).some((problem) =>
      problem.includes("wrap the remote command in sh -c"),
    ),
  ).toBe(true);
});

test("a deploy workflow that wraps the remote command in sh -c without set -e is reported", () => {
  const deploy = workersDeployWorkflow();
  const step = readWorkflowStep(deploy, MARKETING_SYNC_STEP) ?? "";
  const [remote] = flyctlRemoteCommands(step);

  expect(remote).toContain("set -e;");

  const noFailFast = (remote ?? "").replace("set -e; ", "");

  expect(noFailFast).not.toContain("set -e");
  expect(
    findWorkersDeployProblems({ deploy: deploy.replace(remote ?? "", noFailFast) }).some(
      (problem) => problem.includes("without set -e"),
    ),
  ).toBe(true);
});

test("a deploy workflow that syncs the page after the marketing deploy is reported", () => {
  const deploy = workersDeployWorkflow();
  const sync = workersStepBlock(deploy, MARKETING_SYNC_STEP);
  const withoutSync = deploy.replace(sync, "");

  const reordered = withoutSync.replace(
    "      - name: Deploy the sentinel Worker",
    `${sync}      - name: Deploy the sentinel Worker`,
  );

  expect(
    findWorkersDeployProblems({ deploy: reordered }).some((problem) =>
      problem.includes('before "Sync dist-marketing'),
    ),
  ).toBe(true);
});

test("a deploy workflow that deploys the marketing Worker before verifying its assets is reported", () => {
  const deploy = workersDeployWorkflow();
  const verify = workersStepBlock(deploy, MARKETING_PRE_DEPLOY_VERIFY_STEP);
  const withoutVerify = deploy.replace(verify, "");

  const reordered = withoutVerify.replace(
    "      - name: Deploy the sentinel Worker",
    `${verify}      - name: Deploy the sentinel Worker`,
  );

  expect(
    findWorkersDeployProblems({ deploy: reordered }).some((problem) =>
      problem.includes("deploys the marketing Worker before"),
    ),
  ).toBe(true);
});

test("a deploy workflow that does not verify the live landing after the deploy is reported", () => {
  const deploy = workersDeployWorkflow().replace(
    `      - name: ${MARKETING_POST_DEPLOY_VERIFY_STEP}`,
    "      - name: Done",
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) =>
      problem.includes("after deploying the Worker"),
    ),
  ).toBe(true);
});

test("a deploy workflow that verifies the wrong origin in either direction is reported", () => {
  const deploy = workersDeployWorkflow();

  const swapped = deploy
    .replace("--base https://overture-web.fly.dev", "--base https://tryoverture.com")
    .replace(
      "--base https://tryoverture.com --attempts",
      "--base https://overture-web.fly.dev --attempts",
    );

  const problems = findWorkersDeployProblems({ deploy: swapped });

  expect(
    problems.some((problem) =>
      problem.includes("against a base other than https://overture-web.fly.dev"),
    ),
  ).toBe(true);
  expect(
    problems.some((problem) =>
      problem.includes("against a base other than https://tryoverture.com"),
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
    `ref: \${{ github.event.workflow_run.head_sha }}`,
    "ref: main",
  );

  expect(
    findWorkersDeployProblems({ deploy }).some((problem) => problem.includes("head SHA")),
  ).toBe(true);
});

afterEach(removeMarketingSyncSandboxes);

test("the shipped marketing sync extracts dist-marketing byte-for-byte through a no-shell flyctl exec", () => {
  const sandbox = marketingSyncSandbox();

  const { body, remote } = marketingSyncScript(
    readFileSync(".github/workflows/deploy.yml", "utf8"),
  );

  expect(remote.startsWith("sh -c '")).toBe(true);
  expect(body).toContain("flyctl ssh console");

  const { output, status } = sandbox.run(body);

  expect(output).not.toContain("::error::");
  expect(status).toBe(0);
  expect(output).toContain(`synced ${MARKETING_SYNC_FIXTURES.length} file(s) from overture-web`);

  expect(snapshotTree(join(sandbox.workDirectory, "dist-marketing"))).toStrictEqual(
    snapshotTree(join(sandbox.appDirectory, "dist-marketing")),
  );
  expect(readdirSync(sandbox.remoteTmp)).toStrictEqual([]);
});

test("the marketing sync fails the job when the machine has no dist-marketing to send", () => {
  const sandbox = marketingSyncSandbox();

  const { body } = marketingSyncScript(readFileSync(".github/workflows/deploy.yml", "utf8"));

  rmSync(join(sandbox.appDirectory, "dist-marketing"), { force: true, recursive: true });

  const { output, status } = sandbox.run(body);

  expect(status).not.toBe(0);
  expect(output).toContain("Could not extract /app/dist-marketing from overture-web");
  expect(existsSync(join(sandbox.workDirectory, "dist-marketing", "index.html"))).toBe(false);
  expect(readdirSync(sandbox.remoteTmp)).toStrictEqual([]);
});

test("the unwrapped marketing sync fails loudly instead of extracting a frame", () => {
  const sandbox = marketingSyncSandbox();

  const { body, remote } = marketingSyncScript(
    readFileSync(".github/workflows/deploy.yml", "utf8"),
  );

  const unwrapped = `printf '%s\\n' '\${begin_marker}'; tar -czf - -C /app dist-marketing | base64; printf '%s\\n' '\${end_marker}'`;

  expect(remote).not.toBe("");
  expect(body).toContain(remote);

  const { output, status } = sandbox.run(body.replace(remote, unwrapped));

  expect(status).not.toBe(0);
  expect(output).toContain("The archive from overture-web was not a clean base64 tar stream");
  expect(output).toMatch(/unexpected end of file/u);
  expect(existsSync(join(sandbox.workDirectory, "dist-marketing", "index.html"))).toBe(false);
  expect(readdirSync(sandbox.remoteTmp)).toStrictEqual([]);
});

afterEach(removeLaunchSecretSandboxes);

test("the shipped deploy gate and ops sync carry the freehire key behind its opt-in", () => {
  expect(
    findFreehireLaunchSecretProblems({
      deploy: readFileSync(".github/workflows/deploy.yml", "utf8"),
      opsLive: recoveryWorkflow(),
    }),
  ).toStrictEqual([]);
});

test("a deploy gate that requires FREEHIRE_API_KEY on every deploy is reported", () => {
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8").replace(
    'required="R2_ACCOUNT_ID',
    'required="FREEHIRE_API_KEY R2_ACCOUNT_ID',
  );

  expect(
    findFreehireLaunchSecretProblems({ deploy, opsLive: recoveryWorkflow() }).some((problem) =>
      problem.includes("must stay behind REQUIRE_FREEHIRE_API_KEY"),
    ),
  ).toBe(true);
});

test("a deploy gate without the REQUIRE_FREEHIRE_API_KEY variable is reported", () => {
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8").replace(
    `          ${variableReference("REQUIRE_FREEHIRE_API_KEY")}\n`,
    "",
  );

  expect(
    findFreehireLaunchSecretProblems({ deploy, opsLive: recoveryWorkflow() }).some((problem) =>
      problem.includes("does not read the REQUIRE_FREEHIRE_API_KEY repository variable"),
    ),
  ).toBe(true);
});

test("a deploy gate that reads the FREEHIRE_API_KEY value is reported", () => {
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8").replace(
    variableReference("REQUIRE_FREEHIRE_API_KEY"),
    secretReference("FREEHIRE_API_KEY"),
  );

  expect(
    findFreehireLaunchSecretProblems({ deploy, opsLive: recoveryWorkflow() }).some((problem) =>
      problem.includes("reads the FREEHIRE_API_KEY secret value"),
    ),
  ).toBe(true);
});

test("an ops sync that does not mask FREEHIRE_API_KEY is reported", () => {
  const opsLive = recoveryWorkflow().replace(/echo "::add-mask::\$FREEHIRE_API_KEY"\n/u, "");

  expect(
    findFreehireLaunchSecretProblems({
      deploy: readFileSync(".github/workflows/deploy.yml", "utf8"),
      opsLive,
    }).some((problem) => problem.includes("mask FREEHIRE_API_KEY")),
  ).toBe(true);
});

test("an ops sync that would send an empty FREEHIRE_API_KEY is reported", () => {
  const opsLive = recoveryWorkflow().replace(
    / {10}if \[ -n "\$\{FREEHIRE_API_KEY:-\}" \]; then/u,
    "          if true; then",
  );

  expect(
    findFreehireLaunchSecretProblems({
      deploy: readFileSync(".github/workflows/deploy.yml", "utf8"),
      opsLive,
    }).some((problem) => problem.includes("non-empty check")),
  ).toBe(true);
});

test("the deploy gate passes while the freehire opt-in is off and the key is missing", () => {
  const sandbox = launchSecretSandbox();

  const { output, status } = sandbox.run(
    deploySecretGateScript(readFileSync(".github/workflows/deploy.yml", "utf8")),
    { flySecrets: REQUIRED_FLY_SECRETS },
  );

  expect(status).toBe(0);
  expect(output).not.toContain("::error::");
});

test("the deploy gate refuses when FREEHIRE_API_KEY is required and missing", () => {
  const sandbox = launchSecretSandbox();

  const { output, status, summary } = sandbox.run(
    deploySecretGateScript(readFileSync(".github/workflows/deploy.yml", "utf8")),
    { flySecrets: REQUIRED_FLY_SECRETS, vars: { REQUIRE_FREEHIRE_API_KEY: "true" } },
  );

  expect(status).not.toBe(0);
  expect(output).toContain("::error::Fly secrets missing on overture-web");
  expect(output).toContain("FREEHIRE_API_KEY");
  expect(summary).toContain("FREEHIRE_API_KEY");
});

test("the deploy gate passes when the required FREEHIRE_API_KEY is present", () => {
  const sandbox = launchSecretSandbox();

  const { output, status } = sandbox.run(
    deploySecretGateScript(readFileSync(".github/workflows/deploy.yml", "utf8")),
    {
      flySecrets: [...REQUIRED_FLY_SECRETS, "FREEHIRE_API_KEY"],
      vars: { REQUIRE_FREEHIRE_API_KEY: "true" },
    },
  );

  expect(status).toBe(0);
  expect(output).not.toContain("::error::");
});

test("the ops sync imports FREEHIRE_API_KEY only when the repository secret is set", () => {
  const sandbox = launchSecretSandbox();
  const sync = opsSecretSyncScript(recoveryWorkflow());

  const withKey = sandbox.run(sync, { vars: { FREEHIRE_API_KEY: "fh_live_test_key" } });

  expect(withKey.status).toBe(0);
  expect(withKey.imported).toContain("FREEHIRE_API_KEY=fh_live_test_key");
  expect(withKey.summary).toContain("FREEHIRE_API_KEY");
  expect(withKey.summary).not.toContain("fh_live_test_key");

  const withoutKey = sandbox.run(sync, {
    vars: { ALERT_NTFY_URL: "https://ntfy.example/topic" },
  });

  expect(withoutKey.status).toBe(0);
  expect(withoutKey.imported).toContain("ALERT_NTFY_URL=https://ntfy.example/topic");
  expect(withoutKey.imported).not.toContain("FREEHIRE_API_KEY");
  expect(withoutKey.summary).not.toContain("FREEHIRE_API_KEY");
});
