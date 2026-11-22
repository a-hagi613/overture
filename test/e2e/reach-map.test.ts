import { Glob } from "bun";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  buildReachMap,
  computePlan,
  requestedPathsFromText,
  routeMatches,
} from "../../scripts/e2e-ci.ts";

const webRouteEntryPattern =
  /\{\s*path:\s*"(?<path>[^"]+)"\s*,\s*element:\s*<(?<component>[A-Za-z0-9_]+)\s*\/>/gu;

const importBindingPattern =
  /import\s+\{\s*(?<name>[A-Za-z0-9_]+)\s*\}\s+from\s+"(?<specifier>[^"]+)"/gu;

test("every route in src/web/route-table.tsx maps to at least one browser test", () => {
  const map = buildReachMap();
  const mainSource = readFileSync("src/web/route-table.tsx", "utf8");
  const bindings = new Map<string, string>();

  for (const match of mainSource.matchAll(importBindingPattern)) {
    const name = match.groups?.name;
    const specifier = match.groups?.specifier;

    if (name !== undefined && specifier !== undefined) {
      bindings.set(name, specifier);
    }
  }

  const unmappedRoutes: string[] = [];

  for (const match of mainSource.matchAll(webRouteEntryPattern)) {
    const urlPath = match.groups?.path;
    const component = match.groups?.component;

    if (urlPath === undefined || component === undefined) {
      continue;
    }

    const specifier = bindings.get(component);

    if (specifier === undefined) {
      unmappedRoutes.push(urlPath);
      continue;
    }

    const routeFile = specifier.replace(/^\.\//u, "src/web/");

    const covered = Object.values(map.tests).some(
      (entry) => entry.routes.includes(urlPath) || entry.modules.includes(routeFile),
    );

    if (!covered) {
      unmappedRoutes.push(`${urlPath} (${routeFile})`);
    }
  }

  expect(unmappedRoutes).toEqual([]);
});

test("the /api prefix bug stays fixed and regex literals are ignored", () => {
  expect(routeMatches(["api"], ["api", "home"], false)).toBe(false);
  expect(routeMatches(["api"], ["api", "home"], true)).toBe(false);
  expect(routeMatches(["api", "home"], ["api", "home"], false)).toBe(true);
  expect(
    routeMatches(
      ["api", "applications", ":param", "approve"],
      ["api", "applications", ":id", "approve"],
      false,
    ),
  ).toBe(true);
  expect(routeMatches(["admin", "api", "users"], ["admin", "api", "users", ":id"], true)).toBe(
    true,
  );
  expect(routeMatches(["admin", "api", "users"], ["admin", "api", "users", ":id"], false)).toBe(
    false,
  );

  const paramName = "id";

  const extracted = requestedPathsFromText(
    [
      String.raw`const rx = /https?:\/\/[^\s]+|\/api\/auth\/[^\s]+/u;`,
      `const url = \`/api/applications/\${${paramName}}/approve\`;`,
    ].join("\n"),
  );

  expect(extracted).toEqual([{ path: "/api/applications/:param/approve", trailingSlash: false }]);

  const map = buildReachMap();

  const testsWithBareApiPath: string[] = [];

  for (const [name, entry] of Object.entries(map.tests)) {
    if (entry.paths.includes("/api")) {
      testsWithBareApiPath.push(name);
    }
  }

  expect(testsWithBareApiPath).toEqual([]);
});

test("test-only diffs select only the touched test and single-route UI edits stay narrow while main stays full", () => {
  const map = buildReachMap();

  const allTests = [...new Glob("test/e2e/**/*.test.ts").scanSync({ cwd: process.cwd() })].toSorted(
    (left, right) => left.localeCompare(right),
  );

  const testOnlyPlan = computePlan({
    changed: ["test/e2e/passwordless-auth.test.ts"],
    isMain: false,
    shardCount: 6,
    map,
    seconds: {},
    allTests,
  });

  expect(testOnlyPlan.full).toBe(false);
  expect(testOnlyPlan.selected).toEqual(["test/e2e/passwordless-auth.test.ts"]);
  expect(testOnlyPlan.shards).toHaveLength(1);

  const boardCardPlan = computePlan({
    changed: ["src/web/components/board-card.tsx", "design/review/278/home-demo-1280-light.png"],
    isMain: false,
    shardCount: 6,
    map,
    seconds: {},
    allTests,
  });

  const offBoard = boardCardPlan.selected.filter(
    (name) => !(map.tests[name]?.routes ?? []).includes("/board"),
  );

  expect(boardCardPlan.full).toBe(false);
  expect(boardCardPlan.selected).toContain("test/e2e/board-match-board.test.ts");
  expect(offBoard).toEqual([]);
  expect(boardCardPlan.selected.length).toBeLessThan(allTests.length / 3);

  const unitTestOnlyPlan = computePlan({
    changed: ["src/server/billing/ledger.test.ts"],
    isMain: false,
    shardCount: 6,
    map,
    seconds: {},
    allTests,
  });

  expect(unitTestOnlyPlan.full).toBe(false);
  expect(unitTestOnlyPlan.selected).toEqual([]);

  const mainPlan = computePlan({
    changed: [],
    isMain: true,
    shardCount: 6,
    map,
    seconds: {},
    allTests,
  });

  expect(mainPlan.full).toBe(true);
  expect(mainPlan.selected).toEqual(allTests);
});
