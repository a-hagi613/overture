import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findBunVersionDrift, readBunVersions } from "./workflow-config-guard.ts";

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
