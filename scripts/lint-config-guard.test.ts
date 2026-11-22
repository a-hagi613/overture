import { expect, test } from "bun:test";

import { findUnitTestAllowlistProblems } from "./lint-config-guard.ts";

const unitTestFiles = ["src/server/billing/ledger.test.ts", "scripts/database-sync-guard.test.ts"];

test("a complete allowlist that matches the unit test files passes", () => {
  expect(
    findUnitTestAllowlistProblems({
      allow: [...unitTestFiles],
      unitTestFiles,
    }),
  ).toStrictEqual([]);
});

test("an allowlist entry with no file on disk is reported", () => {
  const problems = findUnitTestAllowlistProblems({
    allow: [...unitTestFiles, "src/server/profile/address.test.ts"],
    unitTestFiles,
  });

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("src/server/profile/address.test.ts");
  expect(problems[0]).toContain("does not exist");
});

test("a unit test file the allowlist does not name is reported", () => {
  const problems = findUnitTestAllowlistProblems({
    allow: ["src/server/billing/ledger.test.ts"],
    unitTestFiles,
  });

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("scripts/database-sync-guard.test.ts");
  expect(problems[0]).toContain("not in the allowlist");
});

test("a duplicate allowlist entry changes nothing", () => {
  expect(
    findUnitTestAllowlistProblems({
      allow: [...unitTestFiles, "src/server/billing/ledger.test.ts"],
      unitTestFiles,
    }),
  ).toStrictEqual([]);
});
