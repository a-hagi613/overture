import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { z } from "zod";

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

  return withDashes.startsWith("eslint/") ? withDashes.slice("eslint/".length) : withDashes;
}

function severityOf(value: string | unknown[]) {
  return Array.isArray(value) ? value[0] : value;
}

function tableRules(markdown: string, heading: string) {
  const rules: string[] = [];
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

    for (const match of (cells[0] ?? "").matchAll(/`(?<rule>[^`]+)`/gu)) {
      if (match[1] !== undefined) {
        rules.push(normalizeRule(match[1]));
      }
    }
  }

  return rules;
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

const printed = spawnSync("bunx", ["oxlint", "--print-config"], { encoding: "utf8" });

if (printed.status !== 0) {
  throw new Error(`oxlint --print-config failed: ${printed.stderr}`);
}

const printedLines = printedConfigSchema.parse(JSON.parse(printed.stdout));
const project = projectConfigSchema.parse(JSON.parse(readFileSync(".oxlintrc.json", "utf8")));
const adr = readFileSync("docs/adr/0023-lint-rule-set.md", "utf8");
const available = new Set(Object.keys(printedLines.rules));

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

const scoped = expandWildcards(tableRules(adr, scopedSection), available);

for (const rule of scoped) {
  if (configuredSet.has(rule)) {
    failures.push(`${rule} is off globally but ADR 0023 only turns it off in one folder`);
    continue;
  }

  const turnedOffSomewhere = project.overrides.some(
    (override) => severityOf(override.rules[rule] ?? "deny") === "off",
  );

  if (!turnedOffSomewhere) {
    failures.push(
      `${rule} is not turned off in any override, but ADR 0023 says it is off in one folder`,
    );
  }
}

const notAtError = Object.entries(printedLines.rules)
  .filter(
    ([rule, value]) => severityOf(value) !== "deny" && !configuredSet.has(normalizeRule(rule)),
  )
  .map(([rule]) => rule)
  .toSorted();

for (const rule of notAtError) {
  failures.push(`${rule} is not at error`);
}

if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}

const enabled = Object.values(printedLines.rules).filter(
  (value) => severityOf(value) === "deny",
).length;

process.stdout.write(
  `lint configuration verified: ${String(enabled)} rules at error, ${String(configuredSet.size)} off, all off rules match ADR 0023\n`,
);
