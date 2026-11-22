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
