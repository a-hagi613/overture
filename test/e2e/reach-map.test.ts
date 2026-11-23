import { Glob } from "bun";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  buildReachMap,
  computePlan,
  extractImportBindings,
  requestedPathsFromText,
  routeMatches,
} from "../../scripts/e2e-ci.ts";

const webRouteEntryPattern =
  /\{\s*path:\s*"(?<path>[^"]+)"\s*,\s*element:\s*<(?<component>[A-Za-z0-9_]+)\s*\/>/gu;

const importBindingPattern =
  /import\s+\{\s*(?<name>[A-Za-z0-9_]+)\s*\}\s+from\s+"(?<specifier>[^"]+)"/gu;

const lazyRouteBindingPattern =
  /\bconst\s+(?<name>[A-Za-z0-9_]+)\s*=\s*(?:React\.)?(?:lazyRoute|lazy)\([^;]{0,240}?import\(\s*"(?<specifier>[^"]+)"\s*\)/gu;

test("every route in src/web/route-table.tsx maps to at least one browser test", () => {
  const sampleBindings = extractImportBindings(
    [
      'import { LandingPage } from "./routes/landing.tsx";',
      'const HomePage = lazyRoute(() => import("./routes/home.tsx"), "HomePage");',
      "const BillingReconciliationPage = lazyRoute(",
      '  () => import("./routes/admin/billing-reconciliation.tsx"),',
      '  "BillingReconciliationPage",',
      ");",
    ].join("\n"),
  );

  expect(sampleBindings.get("LandingPage")).toBe("./routes/landing.tsx");
  expect(sampleBindings.get("HomePage")).toBe("./routes/home.tsx");
  expect(sampleBindings.get("BillingReconciliationPage")).toBe(
    "./routes/admin/billing-reconciliation.tsx",
  );

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

  for (const match of mainSource.matchAll(lazyRouteBindingPattern)) {
    const name = match.groups?.name;
    const specifier = match.groups?.specifier;

    if (name !== undefined && specifier !== undefined) {
      bindings.set(name, specifier);
    }
  }

  expect(bindings.get("HomePage")).toBe("./routes/home.tsx");
  expect(bindings.get("OnboardingResumePage")).toBe("./routes/onboarding-resume.tsx");
  expect(bindings.get("BillingReconciliationPage")).toBe(
    "./routes/admin/billing-reconciliation.tsx",
  );

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
    changed: ["src/web/components/tracker-card.tsx", "design/review/278/home-demo-1280-light.png"],
    isMain: false,
    shardCount: 6,
    map,
    seconds: {},
    allTests,
  });

  const boardVisitors = allTests.filter((file) => map.tests[file]?.routes.includes("/board"));

  expect(boardCardPlan.full).toBe(false);
  expect(boardCardPlan.selected).toContain("test/e2e/board-match-board.test.ts");
  expect(boardCardPlan.selected).toEqual(boardVisitors);

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
