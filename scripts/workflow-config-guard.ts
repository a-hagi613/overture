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

  if (!input.weekly.includes("inputs.dry_run != 'true'")) {
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
