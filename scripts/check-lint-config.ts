import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { z } from "zod";

import { findUnguardedDatabaseSyncHandles } from "./database-sync-guard.ts";

const severitySchema = z.union([z.string(), z.array(z.unknown())]);
const rulesSchema = z.record(z.string(), severitySchema);

const printedConfigSchema = z.object({ rules: rulesSchema });

const projectConfigSchema = z.object({
  rules: rulesSchema.default({}),
  overrides: z
    .array(
      z.object({
        files: z.array(z.string()).default([]),
        rules: rulesSchema.default({}),
      }),
    )
    .default([]),
});

const globalSections = ["Rules turned off, and why", "Inherited off-list"];
const scopedSection = "Rules off in one folder only";

function normalizeRule(name: string) {
  const trimmed = name.replaceAll("`", "").trim();

  const withDashes = trimmed
    .replace(/^react-perf\//u, "react_perf/")
    .replace(/^jsx-a11y\//u, "jsx_a11y/");

  return withDashes.replace(/^eslint\//u, "");
}

function severityOf(value: string | unknown[]) {
  return Array.isArray(value) ? value[0] : value;
}

function optionsOf(value: string | unknown[]) {
  return Array.isArray(value) ? value.slice(1).map((option) => JSON.stringify(option)) : [];
}

function lowersRule(value: string | unknown[], base: string | unknown[] | undefined) {
  if (base === undefined) {
    return true;
  }

  if (severityOf(base) === "allow") {
    return false;
  }

  if (severityOf(value) === "allow" || severityOf(value) === "off") {
    return true;
  }

  return optionsOf(value).join(",") !== optionsOf(base).join(",");
}

function tableRows(markdown: string, heading: string) {
  const rows: string[][] = [];
  let inSection = false;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      inSection = line.slice("## ".length).trim() === heading;
      continue;
    }

    if (!inSection || !line.startsWith("|")) {
      continue;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length === 0 || /^-+$/u.test(cells[0] ?? "")) {
      continue;
    }

    rows.push(cells);
  }

  return rows;
}

function tokensIn(cell: string | undefined) {
  return [...(cell ?? "").matchAll(/`(?<token>[^`]+)`/gu)].flatMap((match) =>
    match.groups?.token === undefined ? [] : [match.groups.token],
  );
}

function tableRules(markdown: string, heading: string) {
  return tableRows(markdown, heading).flatMap((cells) =>
    tokensIn(cells[0]).map((token) => normalizeRule(token)),
  );
}

function tableScopedRules(markdown: string, heading: string) {
  const scoped = new Map<string, Set<string>>();

  for (const cells of tableRows(markdown, heading)) {
    const globs = tokensIn(cells[1]);

    for (const rule of tokensIn(cells[0]).map((token) => normalizeRule(token))) {
      const existing = scoped.get(rule) ?? new Set<string>();

      for (const glob of globs) {
        existing.add(glob);
      }

      scoped.set(rule, existing);
    }
  }

  return scoped;
}

function expandWildcards(rules: string[], available: Set<string>) {
  const expanded: string[] = [];

  for (const rule of rules) {
    if (!rule.endsWith("*")) {
      expanded.push(rule);
      continue;
    }

    const prefix = rule.slice(0, -1);

    for (const candidate of available) {
      if (candidate.startsWith(prefix)) {
        expanded.push(candidate);
      }
    }
  }

  return expanded;
}

function formatDifference(label: string, expected: Set<string>, actual: Set<string>) {
  const missing = [...expected].filter((rule) => !actual.has(rule)).toSorted();
  const unexpected = [...actual].filter((rule) => !expected.has(rule)).toSorted();

  if (missing.length === 0 && unexpected.length === 0) {
    return [];
  }

  return [
    `${label} differs from ADR 0023`,
    ...missing.map((rule) => `  turned on but the ADR turns it off: ${rule}`),
    ...unexpected.map((rule) => `  turned off but the ADR does not: ${rule}`),
  ];
}

function formatScopedDifference(
  label: string,
  expected: Map<string, Set<string>>,
  actual: Map<string, Set<string>>,
) {
  const failures: string[] = [];

  for (const [rule, globs] of actual) {
    const documented = expected.get(rule);

    if (documented === undefined) {
      failures.push(
        `${label}: ${rule} is turned down in an override the ADR does not list (${[...globs].join(", ")})`,
      );
      continue;
    }

    if (documented.size !== globs.size || [...globs].some((glob) => !documented.has(glob))) {
      failures.push(
        `${label}: ${rule} is overridden for ${[...globs].join(", ")}, the ADR lists ${[...documented].join(", ")}`,
      );
    }
  }

  for (const [rule, globs] of expected) {
    if (!actual.has(rule)) {
      failures.push(
        `${label}: the ADR lists ${rule} as scoped off but no override turns it down (${[...globs].join(", ")})`,
      );
    }
  }

  return failures;
}

function trackedSources() {
  const listed = spawnSync("git", ["ls-files", "-z", "--", "src", "test"], { encoding: "utf8" });

  if (listed.status !== 0) {
    throw new Error(`git ls-files failed: ${listed.stderr}`);
  }

  return listed.stdout
    .split("\0")
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

const printed = spawnSync("bunx", ["oxlint", "--print-config"], { encoding: "utf8" });

if (printed.status !== 0) {
  throw new Error(`oxlint --print-config failed: ${printed.stderr}`);
}

const printedLines = printedConfigSchema.parse(JSON.parse(printed.stdout));
const project = projectConfigSchema.parse(JSON.parse(readFileSync(".oxlintrc.json", "utf8")));
const adr = readFileSync("docs/adr/0023-lint-rule-set.md", "utf8");
const available = new Set(Object.keys(printedLines.rules));

const baseRules = new Map(
  Object.entries(printedLines.rules).map(([rule, value]) => [normalizeRule(rule), value]),
);

const documentedOff = expandWildcards(
  globalSections.flatMap((heading) => tableRules(adr, heading)),
  available,
);

const configuredOff = Object.entries(printedLines.rules)
  .filter(([, value]) => severityOf(value) === "allow")
  .map(([rule]) => normalizeRule(rule));

const documentedSet = new Set(documentedOff);
const configuredSet = new Set(configuredOff);
const failures = formatDifference("the off-list", documentedSet, configuredSet);

const configuredScoped = new Map<string, Set<string>>();

for (const override of project.overrides) {
  for (const [rule, value] of Object.entries(override.rules)) {
    const name = normalizeRule(rule);

    if (!lowersRule(value, baseRules.get(name))) {
      continue;
    }

    if (configuredSet.has(name)) {
      failures.push(
        `${name} is off globally, so an override for ${override.files.join(", ")} changes nothing`,
      );
      continue;
    }

    const globs = configuredScoped.get(name) ?? new Set<string>();

    for (const glob of override.files) {
      globs.add(glob);
    }

    configuredScoped.set(name, globs);
  }
}

const documentedScoped = tableScopedRules(adr, scopedSection);

failures.push(...formatScopedDifference("scoped overrides", documentedScoped, configuredScoped));

const notAtError = Object.entries(printedLines.rules)
  .filter(
    ([rule, value]) => severityOf(value) !== "deny" && !configuredSet.has(normalizeRule(rule)),
  )
  .map(([rule]) => rule)
  .toSorted();

for (const rule of notAtError) {
  failures.push(`${rule} is not at error`);
}

const appSources = trackedSources();

failures.push(...findUnguardedDatabaseSyncHandles(appSources));

if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}

const enabled = Object.values(printedLines.rules).filter(
  (value) => severityOf(value) === "deny",
).length;

process.stdout.write(
  `lint configuration verified: ${String(enabled)} rules at error, ${String(configuredSet.size)} off, ${String(configuredScoped.size)} documented scoped overrides\n`,
);

process.stdout.write(
  `sqlite handles verified: ${String(appSources.length)} src/test files, every DatabaseSync sets busy_timeout or opts out\n`,
);
