export interface UnitTestAllowlistInput {
  readonly allow: readonly string[];
  readonly unitTestFiles: readonly string[];
}

export function findUnitTestAllowlistProblems(input: UnitTestAllowlistInput) {
  const onDisk = new Set(input.unitTestFiles);
  const allowed = new Set(input.allow);
  const problems: string[] = [];

  for (const path of allowed) {
    if (!onDisk.has(path)) {
      problems.push(
        `overture/no-unlisted-unit-test lists ${path}, which does not exist; delete the stale entry`,
      );
    }
  }

  for (const path of onDisk) {
    if (!allowed.has(path)) {
      problems.push(
        `overture/no-unlisted-unit-test does not name ${path}; it is not in the allowlist, so add it or move the test into test/e2e`,
      );
    }
  }

  return problems.toSorted();
}
