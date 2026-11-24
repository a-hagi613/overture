export interface WorkflowPins {
  readonly path: string;
  readonly versions: readonly string[];
}

export interface BunVersionDriftInput {
  readonly pinned: string;
  readonly workflows: readonly WorkflowPins[];
}

export function readBunVersions(source: string) {
  return [...source.matchAll(/bun-version:\s*["']?(?<version>[^\s"']+)/gu)].map(
    (match) => match.groups?.version ?? "",
  );
}

export function readWorkflowStep(source: string, name: string) {
  const marker = `- name: ${name}`;
  const start = source.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const rest = source.slice(start + marker.length);
  const end = rest.search(/^ {6}- /mu);

  return end === -1 ? rest : rest.slice(0, end);
}

export function findBunVersionDrift(input: BunVersionDriftInput) {
  const problems: string[] = [];

  for (const workflow of input.workflows) {
    for (const version of workflow.versions) {
      if (version !== input.pinned) {
        problems.push(
          `.github/workflows/${workflow.path} sets bun-version: ${version}, but package.json pins ${input.pinned}; pin the same version so a runner release cannot break the job`,
        );
      }
    }
  }

  return problems;
}

export interface AdminHostWorkflowInput {
  readonly workflow: string;
}

const ADMIN_HOST_ACTIONS = ["status", "add-cert", "set-access-secrets"] as const;
const ADMIN_HOST_FLYCTL_SHA = "98172f70657cb3e15db199af139be99bd3e61200";

/**
 * Checks the owner-triggered admin-host workflow stays manual, read-only and secret-safe. The workflow pushes the
 * Cloudflare Access values to Fly, so an automatic trigger, a widened permission or a printed value would change
 * production without the owner asking or leak the Access configuration into the job log.
 * @param input The workflow source.
 * @returns Every rule the workflow breaks, empty when it is safe.
 */
export function findAdminHostWorkflowProblems(input: AdminHostWorkflowInput) {
  const problems: string[] = [];
  const source = input.workflow;

  if (!/^on:\s*\n\s+workflow_dispatch:/mu.test(source)) {
    problems.push("ops-admin-host.yml is not manual: it must run on workflow_dispatch only");
  }

  if (
    /^on:\s*(?:push|pull_request|schedule|workflow_run)\b/mu.test(source) ||
    /^\s{2}(?:push|pull_request|schedule|workflow_run):/mu.test(source)
  ) {
    problems.push("ops-admin-host.yml has an automatic trigger; it must stay owner-triggered");
  }

  for (const action of ADMIN_HOST_ACTIONS) {
    if (!source.split("\n").some((line) => line.trim() === `- ${action}`)) {
      problems.push(`ops-admin-host.yml does not offer the ${action} action`);
    }
  }

  if (!/default:\s*status/mu.test(source)) {
    problems.push("ops-admin-host.yml does not default to the read-only status action");
  }

  if (!/concurrency:\s*\n\s+group:\s*ops-admin-host/mu.test(source)) {
    problems.push("ops-admin-host.yml does not serialize runs in the ops-admin-host group");
  }

  const permissionsAt = source.indexOf("\npermissions:");
  const jobsAt = source.indexOf("\njobs:");

  const permissionBlock =
    permissionsAt === -1 || jobsAt === -1 || jobsAt < permissionsAt
      ? []
      : source
          .slice(permissionsAt, jobsAt)
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "" && line !== "permissions:");

  if (permissionBlock.length !== 1 || permissionBlock[0] !== "contents: read") {
    problems.push("ops-admin-host.yml does not limit permissions to contents: read alone");
  }

  if (!/timeout-minutes:\s*10\b/mu.test(source)) {
    problems.push("ops-admin-host.yml does not cap the job at 10 minutes");
  }

  if (!source.includes(`superfly/flyctl-actions/setup-flyctl@${ADMIN_HOST_FLYCTL_SHA}`)) {
    problems.push("ops-admin-host.yml does not pin the flyctl setup action by commit SHA");
  }

  const guardAt = source.indexOf("FLY_API_TOKEN repository secret is not set");
  const nextStepAt = guardAt === -1 ? -1 : source.indexOf("\n      - name:", guardAt);

  const guardStep =
    guardAt === -1 ? "" : source.slice(guardAt, nextStepAt === -1 ? undefined : nextStepAt);

  if (guardAt === -1) {
    problems.push("ops-admin-host.yml does not fail clearly when FLY_API_TOKEN is missing");
  } else if (!guardStep.includes("exit 1")) {
    problems.push("ops-admin-host.yml continues without FLY_API_TOKEN instead of failing");
  }

  if (!source.includes("::add-mask::$CF_ACCESS_AUD")) {
    problems.push("ops-admin-host.yml does not mask CF_ACCESS_AUD before it reaches a command");
  }

  if (!source.includes("Missing repository secrets")) {
    problems.push("ops-admin-host.yml does not refuse set-access-secrets while a value is missing");
  }

  if (
    !source.includes("flyctl secrets list -a overture-web --json") ||
    !source.includes("(.name // .Name // empty)")
  ) {
    problems.push("ops-admin-host.yml does not reduce flyctl secrets list output to names");
  }

  if (/\bdigest\b/iu.test(source)) {
    problems.push("ops-admin-host.yml mentions a secret digest; only names may be read");
  }

  const setAt = source.indexOf("flyctl secrets set");
  const setStepAt = setAt === -1 ? -1 : source.lastIndexOf("\n      - name:", setAt);
  const setStepEnd = setAt === -1 ? -1 : source.indexOf("\n      - name:", setAt);

  const setStep =
    setAt === -1
      ? ""
      : source.slice(setStepAt === -1 ? 0 : setStepAt, setStepEnd === -1 ? undefined : setStepEnd);

  if (setAt === -1) {
    problems.push("ops-admin-host.yml never sets the Access secrets on Fly");
  } else if (!setStep.includes("if: inputs.action == 'set-access-secrets'")) {
    problems.push("ops-admin-host.yml sets Fly secrets without the set-access-secrets guard");
  }

  if ((source.match(/flyctl secrets set/gu) ?? []).length !== 1) {
    problems.push("ops-admin-host.yml must set Fly secrets in exactly one step");
  }

  if (!source.includes("ADMIN_ORIGIN=https://admin.tryoverture.com")) {
    problems.push("ops-admin-host.yml does not set ADMIN_ORIGIN to the admin host");
  }

  if (!source.includes("certs list -a overture-web --json")) {
    problems.push("ops-admin-host.yml does not read the certificate list");
  }

  if (!source.includes('certs add "$hostname" -a overture-web')) {
    problems.push("ops-admin-host.yml does not add the certificate");
  }

  if (!source.includes('certs show "$hostname" -a overture-web --json')) {
    problems.push("ops-admin-host.yml does not read the certificate status and validation target");
  }

  const printsAccessValue = source
    .split("\n")
    .filter((line) => /^\s*(?:echo|printf)\b/u.test(line))
    .some(
      (line) =>
        /\$\{?(?:CF_ACCESS_AUD|CF_ACCESS_TEAM_DOMAIN|CF_ACCESS_JWKS_URL)\b/u.test(line) &&
        !line.includes("::add-mask::"),
    );

  if (printsAccessValue) {
    problems.push("ops-admin-host.yml prints a Cloudflare Access value");
  }

  return problems;
}

export interface RecoveryWorkflowInput {
  readonly opsLive: string;
}

const RECOVERY_ACTIONS = ["reset-catalog", "sync-ops-secrets"] as const;

const RESET_DIAGNOSTICS_STEP =
  "Show the overture-web status, volume and processes before a catalog reset";

const RESET_DELETE_STEP = "Delete only the catalog database files on the overture-web volume";
const RESET_RESTART_STEP = "Restart overture-web onto an empty catalog database";
const RESET_WAIT_STEP = "Wait for overture-web to serve health after the catalog reset";
const SYNC_STEP = "Sync the ops secrets and flags to overture-web";
const SYNC_HEALTH_STEP = "Verify the production health route after the ops secrets sync";
const SYNC_SECRET_NAMES = ["ALERT_NTFY_URL", "CATALOG_REFRESH_SECRET"] as const;

function workflowInputBlock(source: string, name: string) {
  const marker = `\n      ${name}:`;
  const start = source.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const rest = source.slice(start + marker.length);
  const end = rest.search(/^\s{6}[A-Za-z_][\w-]*:/mu);

  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Checks the production recovery actions stay safe to run against the live machine. A catalog reset that removed
 * the application database would destroy every account and application, and an ops-secrets sync that printed a value
 * would leak it into the job log, so both are checked on the workflow source before they ship.
 * @param input The ops-live workflow source.
 * @returns Every safety rule the recovery actions break, empty when they are safe.
 */
export function findRecoveryWorkflowProblems(input: RecoveryWorkflowInput) {
  const problems: string[] = [];
  const source = input.opsLive;
  const lines = source.split("\n");

  for (const action of RECOVERY_ACTIONS) {
    if (!lines.some((line) => line.trim() === `- ${action}`)) {
      problems.push(`ops-live.yml does not offer the ${action} action`);
    }
  }

  const hotSwapInput = workflowInputBlock(source, "enable_catalog_r2_hot_swap");

  if (hotSwapInput === null) {
    problems.push("ops-live.yml does not offer the enable_catalog_r2_hot_swap input");
  } else {
    if (!/type:\s*boolean/u.test(hotSwapInput)) {
      problems.push("ops-live.yml enable_catalog_r2_hot_swap is not a boolean input");
    }

    if (!/default:\s*false/u.test(hotSwapInput)) {
      problems.push("ops-live.yml enable_catalog_r2_hot_swap does not default to false");
    }
  }

  const diagnostics = readWorkflowStep(source, RESET_DIAGNOSTICS_STEP) ?? "";
  const deletion = readWorkflowStep(source, RESET_DELETE_STEP) ?? "";
  const restart = readWorkflowStep(source, RESET_RESTART_STEP) ?? "";
  const wait = readWorkflowStep(source, RESET_WAIT_STEP) ?? "";

  for (const [name, step] of [
    [RESET_DIAGNOSTICS_STEP, diagnostics],
    [RESET_DELETE_STEP, deletion],
    [RESET_RESTART_STEP, restart],
    [RESET_WAIT_STEP, wait],
  ] as const) {
    if (!step.includes("inputs.action == 'reset-catalog'")) {
      problems.push(`ops-live.yml runs "${name}" outside the reset-catalog guard`);
    }
  }

  if (!deletion.includes("rm -f /data/catalog.sqlite")) {
    problems.push("ops-live.yml reset-catalog does not delete the catalog database files");
  }

  if (deletion.includes("/data/app.sqlite")) {
    problems.push(
      "ops-live.yml reset-catalog names /data/app.sqlite; the application database is never touched",
    );
  }

  for (const line of deletion.split("\n")) {
    if (/\brm\b/u.test(line) && !line.includes("/data/catalog.sqlite")) {
      problems.push(
        "ops-live.yml reset-catalog deletes a path that is not a catalog database file",
      );
    }
  }

  const diagnosticsAt = source.indexOf("ps aux");
  const deleteAt = source.indexOf("rm -f /data/catalog.sqlite");

  if (diagnosticsAt === -1) {
    problems.push("ops-live.yml reset-catalog does not show the volume and processes first");
  } else if (deleteAt !== -1 && diagnosticsAt > deleteAt) {
    problems.push("ops-live.yml reset-catalog deletes before it shows the diagnostics");
  }

  if (!restart.includes("flyctl machine restart")) {
    problems.push("ops-live.yml reset-catalog does not restart the app machine");
  }

  if (!restart.includes("bun run /app/src/server/main.ts")) {
    problems.push("ops-live.yml reset-catalog does not kill only the hung Bun server");
  }

  if (/pkill[^\n]*litestream/u.test(restart)) {
    problems.push("ops-live.yml reset-catalog kills Litestream; only the Bun child may be killed");
  }

  if (!wait.includes("seq 1 36")) {
    problems.push("ops-live.yml reset-catalog does not wait up to 180s for the health route");
  }

  if (!wait.includes("flyctl logs -a overture-web --no-tail") || !wait.includes("tail -n 80")) {
    problems.push("ops-live.yml reset-catalog does not print the last 80 log lines on failure");
  }

  if (!wait.includes("exit 1")) {
    problems.push("ops-live.yml reset-catalog does not fail when the health route never answers");
  }

  const sync = readWorkflowStep(source, SYNC_STEP) ?? "";
  const syncHealth = readWorkflowStep(source, SYNC_HEALTH_STEP) ?? "";

  for (const [name, step] of [
    [SYNC_STEP, sync],
    [SYNC_HEALTH_STEP, syncHealth],
  ] as const) {
    if (!step.includes("inputs.action == 'sync-ops-secrets'")) {
      problems.push(`ops-live.yml runs "${name}" outside the sync-ops-secrets guard`);
    }
  }

  for (const secret of SYNC_SECRET_NAMES) {
    if (!sync.includes(`::add-mask::$${secret}`)) {
      problems.push(
        `ops-live.yml sync-ops-secrets does not mask ${secret} before it reaches a command`,
      );
    }

    if (!sync.includes(`${secret}: \${{ secrets.${secret} }}`)) {
      problems.push(
        `ops-live.yml sync-ops-secrets does not read ${secret} from the repository secrets`,
      );
    }
  }

  if (!sync.includes(`ENABLE_CATALOG_R2_HOT_SWAP: \${{ inputs.enable_catalog_r2_hot_swap }}`)) {
    problems.push("ops-live.yml sync-ops-secrets does not pass the hot-swap input through");
  }

  if (!sync.includes(`\${ENABLE_CATALOG_R2_HOT_SWAP:-false}" = "true"`)) {
    problems.push(
      "ops-live.yml sync-ops-secrets sets CATALOG_R2_HOT_SWAP without checking the input",
    );
  }

  if (!sync.includes("No secrets or flags were configured to sync.")) {
    problems.push("ops-live.yml sync-ops-secrets does not refuse an empty sync");
  }

  if (!sync.includes(`printf '%s\\n' "\${set_args[@]}" | flyctl secrets import -a overture-web`)) {
    problems.push("ops-live.yml sync-ops-secrets does not import the collected values");
  }

  const printsValue = sync
    .split("\n")
    .filter((line) => /^\s*(?:echo|printf)\b/u.test(line))
    .some(
      (line) =>
        SYNC_SECRET_NAMES.some((secret) => new RegExp(`\\$\\{?${secret}\\b`, "u").test(line)) &&
        !line.includes("::add-mask::"),
    );

  if (printsValue) {
    problems.push("ops-live.yml sync-ops-secrets prints a secret value");
  }

  const summaryAt = sync.indexOf('>> "$GITHUB_STEP_SUMMARY"');
  const summaryStart = summaryAt === -1 ? -1 : sync.lastIndexOf("{\n", summaryAt);

  const summaryBlock =
    summaryAt === -1 || summaryStart === -1 ? "" : sync.slice(summaryStart, summaryAt);

  if (!summaryBlock.includes(`"\${key_names[@]}"`)) {
    problems.push("ops-live.yml sync-ops-secrets does not list the imported secret names");
  }

  if (summaryBlock.includes(`\${set_args[@]}`)) {
    problems.push("ops-live.yml sync-ops-secrets writes secret values into the step summary");
  }

  if (!syncHealth.includes("seq 1 24") || !syncHealth.includes("api/health")) {
    problems.push(
      "ops-live.yml sync-ops-secrets does not verify the health route after the import",
    );
  }

  return problems;
}

export interface VacuumWorkflowInput {
  readonly entrypoint: string;
  readonly opsLive: string;
  readonly weekly: string;
}

/**
 * Checks the database compaction workflows keep a destructive pass behind a dry run, a threshold and a health
 * check. A weekly job that stopped the app before measuring its freelist, or a maintenance entrypoint that ran
 * without `--confirm`, would compact production on every run and could leave it down.
 * @param input The two workflow sources and the Docker entrypoint that runs the maintenance pass.
 * @returns Every safety rule the workflows break, empty when they are safe.
 */
export function findVacuumWorkflowProblems(input: VacuumWorkflowInput) {
  const problems: string[] = [];
  const opsPlan = input.opsLive.indexOf("vacuum-fly.ts plan");
  const opsCompact = input.opsLive.indexOf("vacuum-fly.ts compact");
  const weeklyPlan = input.weekly.indexOf("vacuum-fly.ts plan");
  const weeklyCompact = input.weekly.indexOf("vacuum-fly.ts compact");

  if (!input.opsLive.includes("- vacuum-db")) {
    problems.push("ops-live.yml does not offer the vacuum-db action");
  }

  if (opsPlan === -1 || opsCompact === -1) {
    problems.push("ops-live.yml does not run vacuum-fly.ts plan and compact");
  } else if (opsPlan > opsCompact) {
    problems.push("ops-live.yml compacts before it dry-runs the sizes");
  }

  if (!/cron:\s*["']0 5 \* \* 0["']/u.test(input.weekly)) {
    problems.push("vacuum-db.yml is not scheduled for Sundays at 05:00 UTC");
  }

  if (!/workflow_dispatch:[\s\S]*?dry_run:[\s\S]*?type:\s*boolean/u.test(input.weekly)) {
    problems.push("vacuum-db.yml does not offer a boolean dry_run input");
  }

  if (weeklyPlan === -1 || weeklyCompact === -1) {
    problems.push("vacuum-db.yml does not run vacuum-fly.ts plan and compact");
  } else if (weeklyPlan > weeklyCompact) {
    problems.push("vacuum-db.yml compacts before it dry-runs the sizes");
  }

  if (!input.weekly.includes("!inputs.dry_run")) {
    problems.push("vacuum-db.yml does not skip compaction when dry_run is true");
  }

  if (!input.weekly.includes("inputs.force") || !input.weekly.includes("--force")) {
    problems.push("vacuum-db.yml does not pass the operator's force input through");
  }

  if (!input.entrypoint.includes("VACUUM_ONLY")) {
    problems.push("docker-entrypoint.sh has no VACUUM_ONLY maintenance branch");
  }

  if (!input.entrypoint.includes("vacuum-app-db.ts") || !input.entrypoint.includes("--confirm")) {
    problems.push("docker-entrypoint.sh does not run vacuum-app-db.ts with --confirm");
  }

  return problems;
}
