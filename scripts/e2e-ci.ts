import { Glob } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { z } from "zod";

const importPattern =
  /(?:import\s+type\s+[^;]*?from\s+|export\s+type\s+[^;]*?from\s+)["'](?<typeOnlySpecifier>[^"']+)["']|(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?<specifier>[^"']+)["']/gu;

const bindingPattern = /import\s+(?<clause>[^;]+?)\s+from\s+["'](?<specifier>[^"']+)["']/gu;

const routeMountPattern = /\.route\(\s*"(?<prefix>[^"]+)"\s*,\s*(?<target>[A-Za-z0-9_]+)/gu;

const routeDeclarationPattern =
  /\n {2}routes\.(?:get|post|put|patch|delete|all)\(\s*"(?<path>[^"]+)"/gu;

const factoryPattern = /export function (?<name>create[A-Za-z0-9_]+)/u;

const declarationPattern =
  /^[ \t]*(?:export )?(?:const|let|function|async function)\s+(?<name>[A-Za-z_$][\w$]*)/gmu;

const identifierPattern = /[A-Za-z_$][\w$]*/gu;

const pathTokenPattern = /\/[A-Za-z0-9_][A-Za-z0-9_\-.:]*(?:\/[A-Za-z0-9_][A-Za-z0-9_\-.:]*)*/gu;

const browserPattern = /(?:^|[^\w.])(?:page|ownerPage)\.|toHaveScreenshot|\bcontext\.newPage\(/u;

const jobRoutePattern = /^\/__test__\/jobs(?:\/|$)/u;

const bracedPattern = /\{(?<inner>[^}]*)\}/u;

const namespacePattern = /\*\s+as\s+(?<namespace>[A-Za-z_$][\w$]*)/u;

const defaultBindingPattern = /^(?<name>[A-Za-z_$][\w$]*)\s*(?:,|$)/u;

const alwaysFull = [
  /^\.github\//u,
  /^package\.json$/u,
  /^bun\.lock$/u,
  /^tsconfig\.json$/u,
  /^vite\.config\./u,
  /^drizzle\.config\./u,
  /^playwright\.config\./u,
  /^\.oxlintrc\.json$/u,
  /^\.oxfmtrc\.json$/u,
  /^index\.html$/u,
  /^Dockerfile$/u,
  /^\.dockerignore$/u,
  /^litestream\.yml$/u,
  /^fly\.toml$/u,
  /^drizzle\//u,
  /^design\//u,
  /^tools\//u,
  /^scripts\//u,
  /^test\/e2e\/(?!.*\.test\.ts$)/u,
  /^src\/server\/app\.ts$/u,
  /^src\/server\/main\.ts$/u,
  /^src\/server\/(?:auth|config|platform|routes|testing)\//u,
  /^src\/web\//u,
  /^src\/shared\//u,
];

const ignored = [/^docs\//u, /\.md$/u, /^LICENSE$/u, /^profile\/README\.md$/u];

const reachTestSchema = z.object({
  full: z.boolean(),
  paths: z.array(z.string()),
  modules: z.array(z.string()),
});

const reachMapSchema = z.object({
  version: z.literal(1),
  tests: z.record(z.string(), reachTestSchema),
});

const timingsSchema = z.object({
  version: z.literal(1),
  seconds: z.record(z.string(), z.number()),
});

const resultSchema = z.object({
  duration: z.number(),
  status: z.string(),
});

const reportSpecSchema = z.object({
  tests: z.array(z.object({ results: z.array(resultSchema) })).default([]),
});

const reportSuiteSchema: z.ZodType<ReportSuite> = z.lazy(() =>
  z.object({
    file: z.string().optional(),
    specs: z.array(reportSpecSchema).default([]),
    suites: z.array(reportSuiteSchema).default([]),
  }),
);

const reportSchema = z.object({ suites: z.array(reportSuiteSchema).default([]) });

const containerPatterns = [
  /^Dockerfile$/u,
  /^scripts\/docker-entrypoint\.sh$/u,
  /^litestream\.yml$/u,
  /^fly\.toml$/u,
  /^package\.json$/u,
  /^bun\.lock$/u,
];

const planSchema = z.object({
  version: z.literal(1),
  full: z.boolean(),
  container: z.boolean(),
  reason: z.string(),
  selected: z.array(z.string()),
  shards: z.array(z.object({ shard: z.number(), load: z.number(), files: z.array(z.string()) })),
});

interface ReachTest {
  full: boolean;
  paths: string[];
  modules: string[];
}

interface ReportSuite {
  file?: string | undefined;
  specs: z.infer<typeof reportSpecSchema>[];
  suites: ReportSuite[];
}

const root = process.cwd();

function flagValue(name: string) {
  const position = process.argv.indexOf(name);

  if (position === -1) {
    return null;
  }

  return process.argv[position + 1] ?? null;
}

function localPath(path: string) {
  if (path.startsWith("/")) {
    return path;
  }

  return join(root, path);
}

function textOf(file: string) {
  return readFileSync(localPath(file), "utf8");
}

function listSources() {
  const files: string[] = [];

  for (const pattern of ["src/**/*.ts", "src/**/*.tsx", "test/e2e/**/*.ts"]) {
    for (const file of new Glob(pattern).scanSync({ cwd: root })) {
      files.push(file);
    }
  }

  return files.toSorted((left, right) => left.localeCompare(right));
}

function runtimeSpecifiers(file: string) {
  const found: string[] = [];

  for (const match of textOf(file).matchAll(importPattern)) {
    const specifier = match.groups?.specifier;

    if (specifier !== undefined) {
      found.push(specifier);
    }
  }

  return found;
}

function resolveSpecifier(fromFile: string, specifier: string, files: Set<string>) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base = normalize(join(dirname(fromFile), specifier));

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (files.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildGraph(files: string[]) {
  const known = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const dependencies: string[] = [];

    for (const specifier of runtimeSpecifiers(file)) {
      const resolved = resolveSpecifier(file, specifier, known);

      if (resolved !== null) {
        dependencies.push(resolved);
      }
    }

    graph.set(file, dependencies);
  }

  return graph;
}

function closureFrom(graph: Map<string, string[]>, roots: readonly string[]) {
  const seen = new Set<string>();
  const stack = [...roots];

  while (stack.length > 0) {
    const file = stack.pop();

    if (file === undefined || seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const dependency of graph.get(file) ?? []) {
      stack.push(dependency);
    }
  }

  return seen;
}

function importBindings(file: string) {
  const bindings = new Map<string, string>();

  for (const match of textOf(file).matchAll(bindingPattern)) {
    const clause = match.groups?.clause?.trim();
    const specifier = match.groups?.specifier;

    if (clause === undefined || specifier === undefined) {
      continue;
    }

    const inner = bracedPattern.exec(clause)?.groups?.inner;

    if (inner !== undefined) {
      for (const part of inner.split(",")) {
        const name = part
          .trim()
          .replace(/^type\s+/u, "")
          .split(/\s+as\s+/u)
          .at(-1)
          ?.trim();

        if (name !== undefined && name.length > 0) {
          bindings.set(name, specifier);
        }
      }
    }

    const namespace = namespacePattern.exec(clause)?.groups?.namespace;

    if (namespace !== undefined) {
      bindings.set(namespace, specifier);
    }

    const defaultBinding = defaultBindingPattern.exec(clause)?.groups?.name;

    if (defaultBinding !== undefined) {
      bindings.set(defaultBinding, specifier);
    }
  }

  return bindings;
}

function declarationBlocks(file: string) {
  const text = textOf(file);

  const starts = [...text.matchAll(declarationPattern)].map((match) => ({
    name: match.groups?.name ?? "",
    index: match.index,
  }));

  const blocks = new Map<string, string>();

  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1]?.index ?? text.length;

    blocks.set(start.name, text.slice(start.index, end));
  }

  return blocks;
}

function identifiersIn(text: string) {
  return new Set([...text.matchAll(identifierPattern)].map((match) => match[0]));
}

function collectBlocks(blocks: Map<string, string>, used: Iterable<string>) {
  const seen = new Set<string>();
  const pending = [...used];
  const collected = new Set<string>();

  while (pending.length > 0) {
    const name = pending.pop();

    if (name === undefined || seen.has(name)) {
      continue;
    }

    seen.add(name);

    const block = blocks.get(name);

    if (block === undefined) {
      continue;
    }

    for (const identifier of identifiersIn(block)) {
      collected.add(identifier);
      pending.push(identifier);
    }
  }

  return collected;
}

function routeMounts(files: Set<string>) {
  const prefixes = new Map<string, string>();

  for (const match of textOf("src/server/app.ts").matchAll(routeMountPattern)) {
    const prefix = match.groups?.prefix;
    const target = match.groups?.target;

    if (prefix !== undefined && target !== undefined) {
      prefixes.set(target, prefix);
    }
  }

  prefixes.set("adminApi", "/admin/api");

  const routes = new Map<string, string>();

  for (const file of files) {
    if (!file.startsWith("src/server/routes/")) {
      continue;
    }

    const factory = factoryPattern.exec(textOf(file))?.groups?.name;
    const mount = factory === undefined ? undefined : prefixes.get(factory);

    if (mount !== undefined) {
      routes.set(file, mount);
    }
  }

  return routes;
}

function routeModules(file: string, files: Set<string>) {
  const mount = routeMounts(files).get(file) ?? "";
  const bindings = importBindings(file);
  const blocks = declarationBlocks(file);
  const text = textOf(file);
  const declarations = [...text.matchAll(routeDeclarationPattern)];
  const entries: { path: string; modules: string[] }[] = [];

  for (const [position, declaration] of declarations.entries()) {
    const end = declarations[position + 1]?.index ?? text.length;
    const chunk = text.slice(declaration.index, end);
    const collected = collectBlocks(blocks, identifiersIn(chunk));
    const modules = new Set<string>();

    for (const identifier of collected) {
      const specifier = bindings.get(identifier);

      if (specifier === undefined) {
        continue;
      }

      const resolved = resolveSpecifier(file, specifier, files);

      if (resolved !== null) {
        modules.add(resolved);
      }
    }

    entries.push({
      path: `${mount}${declaration.groups?.path ?? ""}`,
      modules: [...modules].toSorted((left, right) => left.localeCompare(right)),
    });
  }

  return entries;
}

function segmentsOf(path: string) {
  return path.split("/").filter((part) => part.length > 0);
}

function routeMatches(requested: readonly string[], route: readonly string[]) {
  if (route.length === 0 || requested.length < route.length - 1) {
    return false;
  }

  for (const [position, routePart] of route.entries()) {
    const requestPart = requested[position];

    if (requestPart === undefined) {
      return position >= route.length - 1;
    }

    if (routePart.startsWith(":")) {
      continue;
    }

    if (routePart !== requestPart) {
      return false;
    }
  }

  return true;
}

function requestedPaths(files: readonly string[]) {
  const paths = new Set<string>();

  for (const file of files) {
    for (const match of textOf(file).matchAll(pathTokenPattern)) {
      paths.add(match[0]);
    }
  }

  return [...paths].toSorted((left, right) => left.localeCompare(right));
}

function isNodeFile(file: string) {
  return file.startsWith("src/") && !file.startsWith("src/server/platform/");
}

function jobHandlerModules(files: Set<string>) {
  const file = "src/server/main.ts";
  const bindings = importBindings(file);
  const blocks = declarationBlocks(file);
  const used = collectBlocks(blocks, ["catalogJobHandlers", "llmJobHandlers", "testJobHandlers"]);
  const modules = new Set<string>();

  for (const identifier of used) {
    const specifier = bindings.get(identifier);

    if (specifier === undefined) {
      continue;
    }

    const resolved = resolveSpecifier(file, specifier, files);

    if (resolved !== null) {
      modules.add(resolved);
    }
  }

  return [...modules];
}

function testReach(testFile: string, graph: Map<string, string[]>, files: Set<string>) {
  const reachable = closureFrom(graph, [testFile]);
  const e2eFiles = [...reachable].filter((file) => file.startsWith("test/e2e/"));
  const directModules = [...reachable].filter((file) => isNodeFile(file));
  const paths = requestedPaths(e2eFiles);
  const routeEntries: { path: string; modules: string[] }[] = [];

  for (const routeFile of files) {
    if (routeFile.startsWith("src/server/routes/")) {
      routeEntries.push(...routeModules(routeFile, files));
    }
  }

  const routeRoots = new Set<string>();
  const matchedPaths = new Set<string>();

  for (const path of paths) {
    const requested = segmentsOf(path);

    for (const entry of routeEntries) {
      if (routeMatches(requested, segmentsOf(entry.path))) {
        matchedPaths.add(path);

        for (const module of entry.modules) {
          routeRoots.add(module);
        }
      }
    }
  }

  if (paths.some((path) => jobRoutePattern.test(path))) {
    for (const module of jobHandlerModules(files)) {
      routeRoots.add(module);
    }
  }

  const usesBrowser = browserPattern.test(textOf(testFile));
  const modules = new Set<string>(directModules);

  for (const module of closureFrom(graph, [...routeRoots])) {
    if (isNodeFile(module)) {
      modules.add(module);
    }
  }

  return {
    full: usesBrowser || (routeRoots.size === 0 && directModules.length === 0),
    paths: [...matchedPaths].toSorted((left, right) => left.localeCompare(right)),
    modules: [...modules].toSorted((left, right) => left.localeCompare(right)),
  };
}

function buildReachMap() {
  const files = listSources();
  const graph = buildGraph(files);
  const known = new Set(files);
  const tests: Record<string, ReachTest> = {};

  for (const file of files) {
    if (file.startsWith("test/e2e/") && file.endsWith(".test.ts")) {
      tests[file] = testReach(file, graph, known);
    }
  }

  return reachMapSchema.parse({ version: 1, tests });
}

function readReachMap() {
  const path = localPath(flagValue("--map") ?? "test/e2e/reach-map.json");

  if (!existsSync(path)) {
    return reachMapSchema.parse({ version: 1, tests: {} });
  }

  return reachMapSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function readTimings() {
  const path = localPath(flagValue("--timings") ?? "test/e2e/timings.json");

  if (!existsSync(path)) {
    return timingsSchema.parse({ version: 1, seconds: {} });
  }

  return timingsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function mergeReport(file: string, seconds: Map<string, number>) {
  const report = reportSchema.parse(JSON.parse(readFileSync(file, "utf8")));

  function visit(suite: ReportSuite, inherited: string | undefined) {
    const named = suite.file ?? inherited;
    const fileOfSuite = named === undefined ? undefined : named.replace(`${root}/`, "");

    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        for (const result of test.results) {
          if (fileOfSuite === undefined || result.status === "skipped") {
            continue;
          }

          seconds.set(fileOfSuite, (seconds.get(fileOfSuite) ?? 0) + result.duration / 1000);
        }
      }
    }

    for (const child of suite.suites) {
      visit(child, fileOfSuite);
    }
  }

  for (const suite of report.suites) {
    visit(suite, undefined);
  }
}

function writeTimings() {
  const directory = localPath(flagValue("--reports") ?? "test-results");
  const output = localPath(flagValue("--out") ?? "test/e2e/timings.json");
  const measured = new Map<string, number>();

  for (const file of new Glob("**/*.json").scanSync({ cwd: directory })) {
    mergeReport(join(directory, file), measured);
  }

  const entries: [string, number][] = Object.entries(readTimings().seconds);

  for (const [file, value] of measured) {
    entries.push([file, Math.round(value * 10) / 10]);
  }

  const seconds = Object.fromEntries(entries.filter(([, value]) => value > 0));

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ version: 1, seconds }, undefined, 2)}\n`);

  process.stdout.write(`timings: ${String(Object.keys(seconds).length)} files\n`);
}

function isAlwaysFull(file: string) {
  return alwaysFull.some((pattern) => pattern.test(file));
}

function isIgnored(file: string) {
  return ignored.some((pattern) => pattern.test(file));
}

function changedFiles(base: string) {
  const child = Bun.spawnSync({
    cmd: ["git", "diff", "--name-only", "--no-renames", `${base}...HEAD`],
    cwd: root,
  });

  if (child.exitCode !== 0) {
    throw new Error(`git diff against ${base} failed: ${child.stderr.toString()}`);
  }

  return child.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function defaultSeconds(seconds: Record<string, number>) {
  const values = Object.values(seconds).toSorted((left, right) => left - right);
  const middle = Math.floor(values.length / 2);

  return values[middle] ?? 1;
}

function assignShards(files: readonly string[], seconds: Record<string, number>, count: number) {
  const fallback = defaultSeconds(seconds);

  const ordered = files
    .map((file) => ({ file, seconds: seconds[file] ?? fallback }))
    .toSorted((left, right) => right.seconds - left.seconds || left.file.localeCompare(right.file));

  const shards = Array.from({ length: count }, (_, index) => ({
    shard: index + 1,
    load: 0,
  }));

  const assigned = new Map<number, string[]>();

  for (const entry of ordered) {
    const [target] = shards.toSorted(
      (left, right) => left.load - right.load || left.shard - right.shard,
    );

    if (target !== undefined) {
      const filesOfShard = assigned.get(target.shard) ?? [];

      filesOfShard.push(entry.file);
      assigned.set(target.shard, filesOfShard);
      target.load += entry.seconds;
    }
  }

  return shards
    .filter((shard) => (assigned.get(shard.shard)?.length ?? 0) > 0)
    .map((shard) => ({
      shard: shard.shard,
      load: Math.round(shard.load * 10) / 10,
      files: (assigned.get(shard.shard) ?? []).toSorted((left, right) => left.localeCompare(right)),
    }));
}

function isKnownModule(map: z.infer<typeof reachMapSchema>, file: string) {
  return Object.values(map.tests).some((test) => test.modules.includes(file));
}

function forcedFull(map: z.infer<typeof reachMapSchema>, touched: readonly string[]) {
  return touched.some(
    (file) =>
      isAlwaysFull(file) ||
      (!file.endsWith(".test.ts") && map.tests[file] === undefined && !isKnownModule(map, file)),
  );
}

function selectionReason(
  isMain: boolean,
  forced: boolean,
  touched: number,
  selected: number,
  total: number,
) {
  if (isMain) {
    return "a push to main runs the full suite";
  }

  if (touched === 0) {
    return "the diff touches only documentation, so no e2e file runs";
  }

  if (forced) {
    return "the diff reaches a file the map cannot classify, so it runs everything";
  }

  return `${String(selected)} of ${String(total)} files are reachable from the diff`;
}

function plan() {
  const base = flagValue("--base");
  const shardCount = Number(flagValue("--shards") ?? "6");
  const output = flagValue("--out");
  const map = readReachMap();
  const changed = base === null ? [] : changedFiles(base);
  const knownTests = new Glob("test/e2e/**/*.test.ts").scanSync({ cwd: root });

  const changedTests = changed.filter(
    (file) => file.endsWith(".test.ts") && existsSync(localPath(file)),
  );

  const allTests = [
    ...new Set([...knownTests, ...Object.keys(map.tests), ...changedTests]),
  ].toSorted((left, right) => left.localeCompare(right));

  const touched = changed.filter((file) => !isIgnored(file));
  const isMain = base === null;
  const forced = Object.keys(map.tests).length === 0 || forcedFull(map, touched);
  const full = isMain || forced;

  let selected = allTests.filter(
    (test) =>
      changedTests.includes(test) ||
      map.tests[test]?.full === true ||
      (map.tests[test]?.modules ?? []).some((module) => touched.includes(module)),
  );

  if (full) {
    selected = allTests;
  }

  if (touched.length === 0 && !isMain) {
    selected = [];
  }

  const container =
    isMain || touched.some((file) => containerPatterns.some((pattern) => pattern.test(file)));

  const planBody = planSchema.parse({
    version: 1,
    full,
    container,
    reason: selectionReason(isMain, forced, touched.length, selected.length, allTests.length),
    selected,
    shards: assignShards(selected, readTimings().seconds, shardCount),
  });

  const lines = planBody.shards.map(
    (shard) => `shard ${String(shard.shard)} ${String(shard.load)}s ${shard.files.join(" ")}`,
  );

  if (output !== null) {
    writeFileSync(localPath(output), `${JSON.stringify(planBody, undefined, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify(planBody, undefined, 2)}\n`);

  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }

  process.stdout.write(`plan: ${planBody.reason}\n`);
}

function emitOutputs() {
  const planPath = localPath(flagValue("--plan") ?? "e2e-plan.json");
  const githubOutput = flagValue("--github-output");

  if (!existsSync(planPath) || githubOutput === null) {
    return;
  }

  const planBody = planSchema.parse(JSON.parse(readFileSync(planPath, "utf8")));
  const e2e = planBody.selected.length > 0 ? "true" : "false";
  const include = planBody.shards.map((shard) => ({ shard: shard.shard }));
  const matrix = { include: include.length > 0 ? include : [{ shard: 1 }] };

  const lines = [
    `e2e=${e2e}`,
    `shards=${String(planBody.shards.length)}`,
    `matrix=${JSON.stringify(matrix)}`,
    `container=${planBody.container ? "true" : "false"}`,
  ];

  writeFileSync(localPath(githubOutput), `${lines.join("\n")}\n`, { flag: "a" });
}

const command = process.argv.at(2);

switch (command) {
  case "map": {
    const output = localPath(flagValue("--out") ?? "test/e2e/reach-map.json");
    const map = buildReachMap();

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(map, undefined, 2)}\n`);
    process.stdout.write(`reach map: ${String(Object.keys(map.tests).length)} test files\n`);
    break;
  }

  case "shard": {
    const planPath = localPath(flagValue("--plan") ?? "e2e-plan.json");
    const shardNumber = Number(flagValue("--shard") ?? "1");
    const planBody = planSchema.parse(JSON.parse(readFileSync(planPath, "utf8")));
    const shard = planBody.shards.find((entry) => entry.shard === shardNumber);

    process.stdout.write((shard?.files ?? []).join(" "));
    break;
  }

  case "timings": {
    writeTimings();
    break;
  }

  case "plan": {
    plan();
    emitOutputs();
    break;
  }

  default: {
    throw new Error("usage: bun run scripts/e2e-ci.ts <map|timings|plan> [flags]");
  }
}
