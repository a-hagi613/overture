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

/**
 * The source of one workflow step, from `- name: <name>` to the next step or the next job, whichever comes first.
 * @param source The workflow, or the job block.
 * @param name The step name.
 * @returns The step source, or null when no step has that name.
 */
export function readWorkflowStep(source: string, name: string) {
  const marker = `- name: ${name}`;
  const start = source.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const rest = source.slice(start + marker.length);
  const end = rest.search(/^ {6}- |^ {2}[A-Za-z_][\w-]*:/mu);

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

/**
 * Every repository secret that spends real money at a third party. Browser Use, Anthropic and freehire bill per
 * session, token and call, and Gemini is retired; a workflow that names one of them can spend without a user doing
 * anything.
 */
export const SPEND_SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "BROWSER_USE_API_KEY",
  "FREEHIRE_API_KEY",
  "GEMINI_API_KEY",
] as const;

const AUTOMATIC_TRIGGERS = [
  "pull_request",
  "pull_request_target",
  "push",
  "release",
  "schedule",
  "workflow_run",
] as const;

export interface WorkflowSource {
  readonly path: string;
  readonly source: string;
}

export interface SpendAllowlistEntry {
  readonly workflow: string;
  readonly secrets: readonly string[];
  readonly reason: string;
}

export interface ScheduledSpendInput {
  readonly workflows: readonly WorkflowSource[];
  readonly allow?: readonly SpendAllowlistEntry[];
}

function triggerBlock(source: string) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^on:\s*$/u.test(line));

  if (start === -1) {
    return lines.filter((line) => /^on:\s*\S+/u.test(line));
  }

  const block: string[] = [];

  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      block.push(line);
      continue;
    }

    if (!/^\s/u.test(line)) {
      break;
    }

    block.push(line);
  }

  return block;
}

/**
 * The triggers that fire this workflow without a person choosing it, in declaration order.
 * @param source The workflow source.
 * @returns The automatic triggers found in the workflow's `on:` block.
 */
export function automaticTriggers(source: string) {
  const found = new Set<string>();

  for (const line of triggerBlock(source)) {
    const keyed = /^\s*(?<trigger>[a-z_]+)\s*:/u.exec(line)?.groups?.["trigger"];
    const inline = /^on:\s*\[(?<list>[^\]]*)\]/u.exec(line)?.groups?.["list"];
    const scalar = /^on:\s*(?<trigger>[a-z_]+)\s*$/u.exec(line)?.groups?.["trigger"];

    if (keyed !== undefined) {
      found.add(keyed);
    }

    if (inline !== undefined) {
      for (const name of inline.split(",")) {
        found.add(name.trim());
      }
    }

    if (scalar !== undefined) {
      found.add(scalar);
    }
  }

  return AUTOMATIC_TRIGGERS.filter((trigger) => found.has(trigger));
}

interface SpendSecretUse {
  readonly secret: string;
  readonly line: number;
  readonly job: string | null;
}

function spendSecretUses(source: string) {
  const uses: SpendSecretUse[] = [];
  const seen = new Set<string>();
  let job: string | null = null;

  for (const [index, line] of source.split("\n").entries()) {
    const jobMatch = /^ {2}(?<job>[A-Za-z0-9_-]+):\s*$/u.exec(line);
    const matchedJob = jobMatch?.groups?.["job"];

    if (matchedJob !== undefined) {
      job = matchedJob;
    }

    for (const secret of SPEND_SECRET_NAMES) {
      const readsSecret = new RegExp(`secrets(?:\\.|\\[\\s*['"]?)${secret}\\b`, "u").test(line);
      const setsSecret = new RegExp(`^\\s*(?:-\\s*)?${secret}\\s*[:=]`, "u").test(line);

      if (!readsSecret && !setsSecret) {
        continue;
      }

      const key = `${secret}:${String(index)}`;

      if (!seen.has(key)) {
        seen.add(key);
        uses.push({ secret, line: index + 1, job });
      }
    }
  }

  return uses;
}

/**
 * Checks that no workflow which runs without a person asking can pass a secret that spends real money (#680). A cron
 * capture run filled real Browser Use sessions every night, and daily catalog ETLs re-ran Haiku over new postings, so
 * this guard fails the build when an automatic workflow names one of those keys and no allow-list entry says why.
 * @param input Every workflow source, plus the allow-list entries the owner has approved.
 * @returns Every workflow that could spend, and every stale allow-list entry, empty when there is nothing to spend.
 */
export function findScheduledSpendProblems(input: ScheduledSpendInput) {
  const problems: string[] = [];
  const allow = input.allow ?? [];

  for (const workflow of input.workflows) {
    const triggers = automaticTriggers(workflow.source);

    if (triggers.length === 0) {
      continue;
    }

    const entry = allow.find((candidate) => candidate.workflow === workflow.path);

    for (const use of spendSecretUses(workflow.source)) {
      if (entry?.secrets.includes(use.secret) === true) {
        continue;
      }

      const where = use.job === null ? "" : `, job ${use.job}`;

      problems.push(
        `.github/workflows/${workflow.path} runs on ${triggers.join(", ")} and passes ${use.secret} (line ${String(use.line)}${where}); no automatic workflow may spend real money — remove the secret, make the job workflow_dispatch only, or add an allow-list entry with the reason`,
      );
    }
  }

  for (const entry of allow) {
    const workflow = input.workflows.find((candidate) => candidate.path === entry.workflow);

    if (workflow === undefined) {
      problems.push(
        `the spend allow-list names .github/workflows/${entry.workflow}, which does not exist; delete the stale entry`,
      );
      continue;
    }

    if (automaticTriggers(workflow.source).length === 0) {
      problems.push(
        `the spend allow-list names .github/workflows/${entry.workflow}, which no longer runs automatically; delete the stale entry`,
      );
      continue;
    }

    const uses = spendSecretUses(workflow.source);

    for (const secret of entry.secrets) {
      if (!uses.some((use) => use.secret === secret)) {
        problems.push(
          `the spend allow-list allows ${secret} in .github/workflows/${entry.workflow}, which no longer passes it; delete the stale entry`,
        );
      }
    }
  }

  return problems;
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

/** The manual step that reads a repository secret and imports it onto `overture-web`. */
export const SYNC_OPS_SECRETS_STEP = "Sync the ops secrets and flags to overture-web";

const SYNC_STEP = SYNC_OPS_SECRETS_STEP;
const SYNC_HEALTH_STEP = "Verify the production health route after the ops secrets sync";
const SYNC_SECRET_NAMES = ["ALERT_NTFY_URL", "FREEHIRE_API_KEY"] as const;

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

  const diagnosticsAt = source.indexOf("/data and the processes");
  const deleteAt = source.indexOf("rm -f /data/catalog.sqlite");

  if (/\bps\s+aux\b/u.test(diagnostics)) {
    problems.push(
      "ops-live.yml reset-catalog calls ps aux; oven/bun:1.4.5-slim ships no procps, so list /proc instead",
    );
  }

  if (!diagnostics.includes("/proc/")) {
    problems.push("ops-live.yml reset-catalog does not list the processes through /proc");
  }

  if (diagnosticsAt === -1) {
    problems.push("ops-live.yml reset-catalog does not show the volume and processes first");
  } else if (deleteAt !== -1 && diagnosticsAt > deleteAt) {
    problems.push("ops-live.yml reset-catalog deletes before it shows the diagnostics");
  }

  if (!restart.includes("flyctl machine restart")) {
    problems.push("ops-live.yml reset-catalog does not restart the app machine");
  }

  if (!restart.includes("/app/src/server/main.ts")) {
    problems.push("ops-live.yml reset-catalog does not kill only the hung Bun server");
  }

  if (/\bpkill\b/u.test(restart)) {
    problems.push(
      "ops-live.yml reset-catalog calls pkill; oven/bun:1.4.5-slim ships no pkill, so scan /proc and send SIGKILL",
    );
  }

  if (!restart.includes("/proc/")) {
    problems.push("ops-live.yml reset-catalog does not find the Bun child through /proc");
  }

  if (/(?:pkill|killall|kill)[^\n]*litestream/iu.test(restart)) {
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

export interface WorkersDeployInput {
  readonly deploy: string;
}

interface WorkerDeploy {
  readonly name: string;
  readonly directory: string;
  readonly keepVars: boolean;
}

const WORKER_DEPLOYS: readonly WorkerDeploy[] = [
  { name: "Deploy the inbound mail Worker", directory: "workers/inbound-mail", keepVars: true },
  { name: "Deploy the marketing Worker", directory: "workers/marketing", keepVars: false },
  { name: "Deploy the sentinel Worker", directory: "workers/sentinel", keepVars: true },
];

/**
 * The step that copies the running Fly release's `dist-marketing` into the job. The Worker's page and the origin's
 * `/assets/*` bundle must come from one build: rebuilding the same commit in this job produced a different
 * `main-*.js` hash (`.dockerignore` changes what Tailwind scans), every landing asset 404'd and React never hydrated.
 */
export const MARKETING_SYNC_STEP = "Sync dist-marketing from the deployed overture-web machine";

/** The check that the freshly synced page's assets exist on the release that will serve them. */
export const MARKETING_PRE_DEPLOY_VERIFY_STEP =
  "Verify the synced marketing assets answer from the Fly release (before the Worker ships)";

/** The check that the live zone serves the deployed page's assets after the Worker ships. */
export const MARKETING_POST_DEPLOY_VERIFY_STEP =
  "Verify the live landing hydrates from the Fly release (after the Worker ships)";

const FLYCTL_SETUP_SHA = "98172f70657cb3e15db199af139be99bd3e61200";

const REMOTE_SHELL_SYNTAX = /[;|&]/u;

/**
 * Every command handed to `flyctl ssh console -C` in a workflow step, in the exact text `flyctl` receives. The
 * machine's SSH server word-splits that string with shell-like quoting and then execs the first word, so it never
 * interprets `;`, `|` or `&&`: a multi-statement command has to travel as one `sh -c '…'` word instead.
 * @param step The workflow step source, continuations included.
 * @returns The `-C`/`--command` payloads in source order.
 */
export function flyctlRemoteCommands(step: string) {
  const flattened = step.replaceAll(/\\\r?\n\s*/gu, " ");
  const commands: string[] = [];

  for (const match of flattened.matchAll(
    /flyctl ssh console\b[^"'\n]*?(?:\s-C|\s--command)\s+(?:"(?<doubleQuoted>(?:[^"\\]|\\.)*)"|'(?<singleQuoted>[^']*)'|(?<bare>\S+))/gu,
  )) {
    const command =
      match.groups?.["doubleQuoted"] ?? match.groups?.["singleQuoted"] ?? match.groups?.["bare"];

    if (command !== undefined) {
      commands.push(command);
    }
  }

  return commands;
}

function readJobBlock(source: string, name: string) {
  const marker = `\n  ${name}:`;
  const start = source.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const rest = source.slice(start + marker.length);
  const end = rest.search(/^\s{2}[A-Za-z_][\w-]*:/mu);

  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The checkout ref shared by both deploy jobs: a `workflow_run` deploy ships the CI run's commit, and a dispatched
 * deploy has no `workflow_run`, so it ships the dispatched ref's SHA (`main` at dispatch time).
 */
export const DEPLOY_CHECKOUT_REF = `ref: \${{ github.event.workflow_run.head_sha || github.sha }}`;

/**
 * Checks the deploy workflow ships the three Cloudflare Workers without wiping dashboard-set values or leaking the
 * API token, and that the marketing Worker ships the Fly release's own prerendered page instead of a second build.
 * A deploy that forgot `--keep-vars` would erase the owner's forwarding address and alert topic; one that rebuilt the
 * marketing assets hashed `/assets/main-*.js` differently than the origin serving it, so every landing asset 404'd.
 * @param input The deploy workflow source.
 * @returns Every rule the deploy workflow breaks, empty when it is safe.
 */
export function findWorkersDeployProblems(input: WorkersDeployInput) {
  const problems: string[] = [];
  const job = readJobBlock(input.deploy, "deploy-workers");

  if (job === null) {
    problems.push("deploy.yml has no deploy-workers job, so the Cloudflare Workers never deploy");

    return problems;
  }

  if (!/^ {4}needs:\s*deploy\s*$/mu.test(job)) {
    problems.push("deploy-workers does not wait for the Fly deploy that ships the matching assets");
  }

  if (!job.includes("needs.deploy.outputs.skip != 'true'")) {
    problems.push("deploy-workers runs even when the Fly deploy was skipped");
  }

  if (!job.includes(DEPLOY_CHECKOUT_REF)) {
    problems.push(
      "deploy-workers does not check out the deploy SHA (the CI run's head SHA, or the dispatched ref's SHA)",
    );
  }

  for (const worker of WORKER_DEPLOYS) {
    const step = readWorkflowStep(job, worker.name);

    if (step === null) {
      problems.push(`deploy-workers does not deploy ${worker.directory}`);
      continue;
    }

    if (!step.includes(`working-directory: ${worker.directory}`)) {
      problems.push(`deploy-workers runs "${worker.name}" outside ${worker.directory}`);
    }

    if (!step.includes("bunx wrangler deploy")) {
      problems.push(`deploy-workers does not deploy ${worker.directory} with wrangler`);
    }

    if (worker.keepVars && !step.includes("bunx wrangler deploy --keep-vars")) {
      problems.push(
        `deploy-workers deploys ${worker.directory} without --keep-vars, wiping the dashboard-set vars and secrets`,
      );
    }
  }

  const marketingAt = job.indexOf("      - name: Deploy the marketing Worker");
  const syncAt = job.indexOf(`      - name: ${MARKETING_SYNC_STEP}`);
  const preVerifyAt = job.indexOf(`      - name: ${MARKETING_PRE_DEPLOY_VERIFY_STEP}`);
  const postVerifyAt = job.indexOf(`      - name: ${MARKETING_POST_DEPLOY_VERIFY_STEP}`);

  if (job.includes("bun run build")) {
    problems.push(
      "deploy-workers runs bun run build; the marketing page must come from the Fly release, because a second build hashes /assets/main-*.js differently than the origin serving it",
    );
  }

  if (!job.includes(`superfly/flyctl-actions/setup-flyctl@${FLYCTL_SETUP_SHA}`)) {
    problems.push(
      "deploy-workers does not set up flyctl, so it cannot extract dist-marketing from the deployed machine",
    );
  }

  const sync = readWorkflowStep(job, MARKETING_SYNC_STEP);

  if (sync === null) {
    problems.push(
      "deploy-workers does not sync dist-marketing from the deployed Fly machine, so the marketing page can drift from the release serving its assets",
    );
  } else {
    if (!sync.includes("flyctl ssh console") || !sync.includes("-a overture-web")) {
      problems.push("deploy-workers does not extract dist-marketing from the overture-web machine");
    }

    const sshLine =
      sync
        .split("\n")
        .find((line) => line.includes("flyctl ssh console") && !line.trimStart().startsWith("#")) ??
      "";

    if (!/\s(?:-q|--quiet)\b/u.test(sshLine)) {
      problems.push(
        "deploy-workers runs flyctl ssh console without -q, so its connection text lands on stdout and corrupts the extracted archive",
      );
    }

    if (!sync.includes("OVERTURE-TAR-BEGIN") || !sync.includes("OVERTURE-TAR-END")) {
      problems.push(
        "deploy-workers does not frame the synced archive between sentinel markers, so stray flyctl output can reach tar",
      );
    }

    if (!sync.includes("base64 -d") || !sync.includes("tar -xzf -")) {
      problems.push(
        "deploy-workers does not decode the framed base64 archive into tar, so binary-safe extraction is gone",
      );
    }

    if (/flyctl ssh console[^\n]*\|[^\n]*tar -xzf/u.test(sync)) {
      problems.push(
        "deploy-workers pipes flyctl stdout straight into tar, so any connection text corrupts the archive",
      );
    }

    for (const remote of flyctlRemoteCommands(sync)) {
      if (!REMOTE_SHELL_SYNTAX.test(remote)) {
        continue;
      }

      if (!/^sh\s+-c\s+\S/u.test(remote)) {
        problems.push(
          "deploy-workers passes a multi-statement command straight to flyctl ssh console -C, which the machine execs without a shell, so only the first word runs and the sentinels never frame the archive; wrap the remote command in sh -c",
        );
        continue;
      }

      if (!/\bset\s+-[A-Za-z]*e|&&|\|\|/u.test(remote)) {
        problems.push(
          "deploy-workers wraps the remote command in sh -c without set -e, so a failed tar or base64 still exits 0 and ships an empty archive",
        );
      }
    }

    if (!sync.includes("dist-marketing")) {
      problems.push("deploy-workers never writes dist-marketing while syncing from Fly");
    }

    if (!sync.includes("exit 1")) {
      problems.push(
        "deploy-workers continues without dist-marketing instead of failing loudly, so stale HTML could ship",
      );
    }
  }

  if (preVerifyAt === -1) {
    problems.push(
      "deploy-workers does not verify the synced marketing assets before deploying the Worker",
    );
  }

  if (postVerifyAt === -1) {
    problems.push(
      "deploy-workers does not verify the live landing's assets after deploying the Worker",
    );
  }

  if (marketingAt !== -1) {
    for (const [name, at] of [
      [MARKETING_SYNC_STEP, syncAt],
      [MARKETING_PRE_DEPLOY_VERIFY_STEP, preVerifyAt],
    ] as const) {
      if (at > marketingAt) {
        problems.push(
          `deploy-workers deploys the marketing Worker before "${name}", so the page can ship without its assets`,
        );
      }
    }

    if (postVerifyAt !== -1 && postVerifyAt < marketingAt) {
      problems.push(
        "deploy-workers checks the live landing before it deploys the marketing Worker, so it verifies the previous page",
      );
    }
  }

  const preVerify = readWorkflowStep(job, MARKETING_PRE_DEPLOY_VERIFY_STEP) ?? "";
  const postVerify = readWorkflowStep(job, MARKETING_POST_DEPLOY_VERIFY_STEP) ?? "";

  for (const [name, step, base] of [
    [MARKETING_PRE_DEPLOY_VERIFY_STEP, preVerify, "https://overture-web.fly.dev"],
    [MARKETING_POST_DEPLOY_VERIFY_STEP, postVerify, "https://tryoverture.com"],
  ] as const) {
    if (!step.includes("scripts/verify-marketing-assets.ts")) {
      problems.push(`deploy-workers runs "${name}" without scripts/verify-marketing-assets.ts`);
    }

    if (!step.includes(`--base ${base}`)) {
      problems.push(`deploy-workers runs "${name}" against a base other than ${base}`);
    }

    if (!step.includes("--dir dist-marketing")) {
      problems.push(`deploy-workers runs "${name}" without the synced dist-marketing directory`);
    }
  }

  if (postVerify !== "" && !postVerify.includes("--attempts")) {
    problems.push(
      "deploy-workers checks the live landing without retrying, so a slow Cloudflare rollout fails a good deploy",
    );
  }

  if (!job.includes(`CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}`)) {
    problems.push("deploy-workers does not pass CLOUDFLARE_API_TOKEN from the repository secrets");
  }

  if (!job.includes(`CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`)) {
    problems.push("deploy-workers does not pass CLOUDFLARE_ACCOUNT_ID from the repository secrets");
  }

  if (!job.includes(`FLY_API_TOKEN: \${{ secrets.FLY_API_TOKEN }}`)) {
    problems.push(
      "deploy-workers does not pass FLY_API_TOKEN, so it cannot read the deployed page",
    );
  }

  const printsToken = job
    .split("\n")
    .filter((line) => /^\s*(?:echo|printf)\b/u.test(line))
    .some((line) => /\$\{?CLOUDFLARE_API_TOKEN\b/u.test(line) && !line.includes("::add-mask::"));

  if (printsToken) {
    problems.push("deploy-workers prints the Cloudflare API token");
  }

  return problems;
}

/** The step that checks the required Fly secret names before a deploy (docs/DEPLOY.md, step 5). */
export const DEPLOY_SECRET_GATE_STEP =
  "Refuse to deploy while a required Fly secret is missing (docs/DEPLOY.md, step 5)";

const FREEHIRE_OPT_IN_CONDITION = /if \[ "\$\{REQUIRE_FREEHIRE_API_KEY:-\}" = "true" \]; then/u;
const FREEHIRE_PRESENT_CONDITION = /if \[ -n "\$\{FREEHIRE_API_KEY:-\}" \]; then/u;

/**
 * The `run:` body of one workflow step, with the YAML block indentation removed, so a test can execute it with bash
 * exactly as GitHub Actions does.
 * @param step The step source from {@link readWorkflowStep}.
 * @returns The script, empty when the step has no `run: |` block.
 */
export function readStepScript(step: string) {
  const lines = step.split("\n");
  const start = lines.findIndex((line) => line.trim() === "run: |");

  if (start === -1) {
    return "";
  }

  return lines
    .slice(start + 1)
    .map((line) => line.replace(/^ {10}/u, ""))
    .join("\n");
}

function shellBlockAfter(script: string, condition: RegExp) {
  const match = condition.exec(script);

  if (match === null) {
    return null;
  }

  const rest = script.slice(match.index);
  const end = rest.indexOf("\nfi");

  return end === -1 ? rest : rest.slice(0, end);
}

export interface FreehireLaunchSecretInput {
  readonly deploy: string;
  readonly opsLive: string;
}

/**
 * Checks the freehire API plan key (#708) is synced and gated without blocking today's deploys. The owner buys the
 * $29/month plan only after #710 passes, so `FREEHIRE_API_KEY` joins the deploy gate behind the
 * `REQUIRE_FREEHIRE_API_KEY` repository variable and the manual sync imports it only when the repository secret is
 * set. The deploy job also runs on every `workflow_run`, so it must never read the secret value itself: only the
 * manual sync holds the key, and the gate reads the name from `flyctl secrets list`.
 * @param input The deploy and ops-live workflow sources.
 * @returns Every freehire launch-secret rule the workflows break, empty when they are safe.
 */
export function findFreehireLaunchSecretProblems(input: FreehireLaunchSecretInput) {
  const problems: string[] = [];
  const gate = readWorkflowStep(input.deploy, DEPLOY_SECRET_GATE_STEP) ?? "";

  if (gate === "") {
    problems.push(
      "deploy.yml has no required-Fly-secret gate, so a missing FREEHIRE_API_KEY could only fail at boot",
    );
  } else {
    if (!gate.includes(`REQUIRE_FREEHIRE_API_KEY: \${{ vars.REQUIRE_FREEHIRE_API_KEY }}`)) {
      problems.push(
        "deploy.yml does not read the REQUIRE_FREEHIRE_API_KEY repository variable, so the freehire key cannot be opt-in",
      );
    }

    const unconditional = gate
      .split("\n")
      .filter((line) => /^\s*required="/u.test(line) && !line.includes("$required"))
      .some((line) => line.includes("FREEHIRE_API_KEY"));

    if (unconditional) {
      problems.push(
        "deploy.yml requires FREEHIRE_API_KEY on every deploy; it must stay behind REQUIRE_FREEHIRE_API_KEY until the owner buys the freehire API plan",
      );
    }

    const optIn = shellBlockAfter(gate, FREEHIRE_OPT_IN_CONDITION);

    if (optIn === null) {
      problems.push(
        "deploy.yml does not gate FREEHIRE_API_KEY behind REQUIRE_FREEHIRE_API_KEY, so the deploy fails before the plan is bought",
      );
    } else if (!optIn.includes('required="$required FREEHIRE_API_KEY"')) {
      problems.push(
        "deploy.yml does not add FREEHIRE_API_KEY to the required list inside the REQUIRE_FREEHIRE_API_KEY gate",
      );
    }

    if (/secrets(?:\.|\[\s*['"]?)FREEHIRE_API_KEY\b/u.test(input.deploy)) {
      problems.push(
        "deploy.yml reads the FREEHIRE_API_KEY secret value; the automatic deploy only checks names, and an automatic workflow must never hold a spend key",
      );
    }
  }

  const sync = readWorkflowStep(input.opsLive, SYNC_OPS_SECRETS_STEP) ?? "";

  if (sync === "") {
    problems.push(
      "ops-live.yml has no sync-ops-secrets step, so FREEHIRE_API_KEY never reaches overture-web",
    );
  } else {
    if (!sync.includes(`FREEHIRE_API_KEY: \${{ secrets.FREEHIRE_API_KEY }}`)) {
      problems.push(
        "ops-live.yml sync-ops-secrets does not read FREEHIRE_API_KEY from the repository secrets",
      );
    }

    if (!sync.includes("::add-mask::$FREEHIRE_API_KEY")) {
      problems.push(
        "ops-live.yml sync-ops-secrets does not mask FREEHIRE_API_KEY before it reaches a command",
      );
    }

    const conditional = shellBlockAfter(sync, FREEHIRE_PRESENT_CONDITION);

    if (conditional === null) {
      problems.push(
        "ops-live.yml sync-ops-secrets does not guard FREEHIRE_API_KEY with a non-empty check, so an unset secret would be sent as an empty value",
      );
    } else if (!conditional.includes('set_args+=("FREEHIRE_API_KEY=$FREEHIRE_API_KEY")')) {
      problems.push(
        "ops-live.yml sync-ops-secrets does not import FREEHIRE_API_KEY inside the non-empty check",
      );
    }
  }

  return problems;
}

/** The step in `auto-merge.yml` that watches an armed auto-merge and starts Deploy for `main`. */
export const AUTO_MERGE_DISPATCH_STEP = "Wait for the merge, then dispatch Deploy for main";

export interface DeployTriggerInput {
  readonly deploy: string;
  readonly autoMerge: string;
}

function jobKeyBlock(job: string, key: string) {
  const at = job.indexOf(`\n    ${key}:`);

  if (at === -1) {
    return null;
  }

  const rest = job.slice(at + 1);
  const end = rest.search(/\n {4}[A-Za-z_][\w-]*:/u);

  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Checks that a green, auto-merged pull request reaches production. GitHub completes an armed auto-merge as
 * `app/github-actions` and starts no workflow for an event caused by `GITHUB_TOKEN`, so the merge creates no CI run on
 * `main` and Deploy's `workflow_run` trigger never fires; a manual or `gh`-token merge does start that CI run. The
 * dispatch job must therefore wait for a real merge, ask for the one permission `gh workflow run` needs, and start
 * Deploy exactly once. `deploy.yml` must accept the dispatch and still run the jobs for the `workflow_run` path.
 * @param input The deploy and auto-merge workflow sources.
 * @returns Every rule the two workflows break, empty when a merge reaches production once.
 */
export function findDeployTriggerProblems(input: DeployTriggerInput) {
  const problems: string[] = [];
  const deployJob = readJobBlock(input.deploy, "deploy");
  const workersJob = readJobBlock(input.deploy, "deploy-workers");
  const armJob = readJobBlock(input.autoMerge, "arm");
  const dispatchJob = readJobBlock(input.autoMerge, "deploy");

  if (!/^ {2}workflow_dispatch:\s*$/mu.test(input.deploy)) {
    problems.push(
      "deploy.yml has no workflow_dispatch trigger, so an auto-merge that starts no CI run has no way to deploy main",
    );
  }

  if (deployJob === null) {
    problems.push("deploy.yml has no deploy job");
  } else {
    if (!deployJob.includes("github.event_name == 'workflow_dispatch'")) {
      problems.push(
        "deploy.yml's deploy job skips a dispatched run, so a dispatched Deploy deploys nothing",
      );
    }

    if (!deployJob.includes(DEPLOY_CHECKOUT_REF)) {
      problems.push(
        "deploy.yml's deploy job does not check out the deploy SHA (the CI run's head SHA, or the dispatched ref's SHA)",
      );
    }

    if (!deployJob.includes("github.event.workflow_run.conclusion == 'success'")) {
      problems.push(
        "deploy.yml's deploy job no longer runs for the CI workflow_run, so a human merge stops deploying",
      );
    }
  }

  if (workersJob !== null && !workersJob.includes("github.event_name == 'workflow_dispatch'")) {
    problems.push(
      "deploy.yml's deploy-workers job skips a dispatched run, so the Workers stay on their previous release",
    );
  }

  if (
    workersJob !== null &&
    !workersJob.includes("github.event.workflow_run.conclusion == 'success'")
  ) {
    problems.push(
      "deploy.yml's deploy-workers job no longer runs for the CI workflow_run, so a human merge stops shipping the Workers",
    );
  }

  if (
    !/^concurrency:\s*\n(?:\s*#[^\n]*\n)*\s+group:\s*deploy-main\s*\n(?:\s*#[^\n]*\n)*\s+cancel-in-progress:\s*false\s*$/mu.test(
      input.deploy,
    )
  ) {
    problems.push(
      "deploy.yml does not serialize deploys in the deploy-main group without cancelling a queued one, so two entry points can race",
    );
  }

  const permissionsAt = input.autoMerge.indexOf("\npermissions:");
  const jobsAt = input.autoMerge.indexOf("\njobs:");

  if (
    permissionsAt !== -1 &&
    jobsAt > permissionsAt &&
    input.autoMerge.slice(permissionsAt, jobsAt).includes("actions: write")
  ) {
    problems.push(
      "auto-merge.yml grants actions: write at the workflow level; only the deploy job's dispatch needs it",
    );
  }

  if (/^concurrency:/mu.test(input.autoMerge)) {
    problems.push(
      "auto-merge.yml sets a workflow-level concurrency group; its cancel-in-progress cancels the job that waits for the merge, so the groups belong on the jobs",
    );
  }

  if (armJob?.includes("gh workflow run")) {
    problems.push(
      "auto-merge.yml dispatches Deploy from the arm job; `gh pr merge --auto` returns before the merge, so the merge must be observed first",
    );
  }

  if (dispatchJob === null) {
    problems.push(
      "auto-merge.yml has no deploy job, so an auto-merged pull request never dispatches Deploy",
    );

    return problems;
  }

  if (/^ {4}needs:/mu.test(dispatchJob)) {
    problems.push(
      "auto-merge.yml's deploy job waits on another job; a run created by an event on an already-merged pull request skips the arm job, and the dispatch would be skipped with it",
    );
  }

  if (/state\s*==\s*'open'/u.test(dispatchJob)) {
    problems.push(
      "auto-merge.yml's deploy job requires an open pull request, so the dispatch never runs for a run created after the merge",
    );
  }

  const deployConcurrency = jobKeyBlock(dispatchJob, "concurrency");

  if (deployConcurrency === null) {
    problems.push(
      "auto-merge.yml's deploy job has no concurrency group of its own, so a newer run cancels the job that waits for the merge",
    );
  } else {
    if (
      !/^\s+group:\s*auto-merge-deploy-\$\{\{\s*github\.event\.pull_request\.number\s*\}\}\s*$/mu.test(
        deployConcurrency,
      )
    ) {
      problems.push(
        "auto-merge.yml's deploy job does not use a per-pull-request concurrency group, so waiters for different pull requests cancel each other",
      );
    }

    if (!/^\s+cancel-in-progress:\s*false\s*$/mu.test(deployConcurrency)) {
      problems.push(
        "auto-merge.yml's deploy job cancels a waiting dispatch when a newer run starts, so the merge it waits for is never dispatched",
      );
    }
  }

  if (armJob !== null) {
    const armConcurrency = jobKeyBlock(armJob, "concurrency");

    if (armConcurrency === null || !/^\s+cancel-in-progress:\s*true\s*$/mu.test(armConcurrency)) {
      problems.push(
        "auto-merge.yml's arm job no longer cancels a superseded run, so a stale arm can finish after a newer one",
      );
    }
  }

  const permissions = jobKeyBlock(dispatchJob, "permissions");

  if (permissions === null) {
    problems.push(
      "auto-merge.yml's deploy job has no permissions block; a dispatch needs actions: write and nothing more",
    );
  } else {
    if (!/^\s+actions:\s*write\s*$/mu.test(permissions)) {
      problems.push(
        "auto-merge.yml's deploy job lacks actions: write, so `gh workflow run` is refused",
      );
    }

    if (!/^\s+contents:\s*read\s*$/mu.test(permissions)) {
      problems.push("auto-merge.yml's deploy job does not limit contents to read");
    }

    if (/^\s+contents:\s*write\s*$/mu.test(permissions)) {
      problems.push(
        "auto-merge.yml's deploy job widens contents to write; only the merge in the arm job needs it",
      );
    }
  }

  const dispatch = readWorkflowStep(dispatchJob, AUTO_MERGE_DISPATCH_STEP);

  if (dispatch === null) {
    problems.push(
      `auto-merge.yml has no "${AUTO_MERGE_DISPATCH_STEP}" step, so a completed merge dispatches nothing`,
    );

    return problems;
  }

  for (const [needle, rule] of [
    ["MERGED", "does not wait for the pull request to merge"],
    ["CLOSED", "does not skip a pull request that closed without merging"],
    [
      `GH_REPO: \${{ github.repository }}`,
      "does not name the repository for `gh` without a checkout",
    ],
    ["mergedBy", "does not leave a person's merge to the push CI path"],
    ["gh run list", "does not skip a tree that already has a Deploy run"],
    ["gh workflow run", "does not dispatch a workflow"],
    ["--ref main", "does not dispatch Deploy for main"],
  ] as const) {
    if (!dispatch.includes(needle)) {
      problems.push(`auto-merge.yml's dispatch step ${rule}`);
    }
  }

  return problems;
}
