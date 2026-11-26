import { Glob } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { z } from "zod";

const importPattern =
  /(?:import\s+type\s+[^;]*?from\s+|export\s+type\s+[^;]*?from\s+)["'](?<typeOnlySpecifier>[^"']+)["']|(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?<specifier>[^"']+)["']/gu;

const bindingPattern = /import\s+(?<clause>[^;]+?)\s+from\s+["'](?<specifier>[^"']+)["']/gu;

const lazyBindingPattern =
  /\bconst\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:React\.)?(?:lazyRoute|lazy)\([^;]{0,240}?import\(\s*["'](?<specifier>[^"']+)["']\s*\)/gu;

const routeMountPattern = /\.route\(\s*"(?<prefix>[^"]+)"\s*,\s*(?<target>[A-Za-z0-9_]+)/gu;

const routeDeclarationPattern =
  /\n {2}routes\.(?:get|post|put|patch|delete|all)\(\s*"(?<path>[^"]+)"/gu;

const factoryPattern = /export function (?<name>create[A-Za-z0-9_]+)/u;

const topDeclarationPattern =
  /^(?:export )?(?:const|let|function|async function)\s+(?<name>[A-Za-z_$][\w$]*)/gmu;

const helperFunctionPattern = /^ {2}(?:async )?function\s+(?<name>[A-Za-z_$][\w$]*)/gmu;

const identifierPattern = /[A-Za-z_$][\w$]*/gu;

const quotedStringPattern = /(?<quote>["'`])(?<raw>(?:\\.|(?!\k<quote>)[^\\])*)\k<quote>/gu;

const pathTokenPattern =
  /\/(?:[A-Za-z0-9_]|:[A-Za-z0-9_])[A-Za-z0-9_\-.:]*(?:\/(?:[A-Za-z0-9_]|:[A-Za-z0-9_])[A-Za-z0-9_\-.:]*)*\/?/gu;

const designRefPattern = /design\/reference\/(?<dir>[A-Za-z0-9_-]+)\//gu;

const playwrightProjectPattern =
  /testMatch:\s*\/(?<match>[^/]+)\/u[\s\S]{0,400}?design\/reference\/(?<dir>[A-Za-z0-9_-]+)\//gu;

const webRouteEntryPattern =
  /\{\s*path:\s*"(?<path>[^"]+)"\s*,\s*element:\s*<(?<component>[A-Za-z0-9_]+)\s*\/>/gu;

const redirectRouteEntryPattern =
  /\{\s*path:\s*"(?<path>[^"]+)"\s*,\s*element:\s*<PreserveSearchRedirect\s+to="(?<to>[^"]+)"\s*\/>/gu;

const billingUserRoutePattern = /\/admin\/billing\/users\/\$\{[^}]*\}(?<refund>\/refund)?/gu;

const gotoPathPattern = /\.(?:goto|toHaveURL)\([\s\S]{0,160}?(?<path>\/[A-Za-z0-9_\-.:/]*)/gu;

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
  /^index\.html$/u,
  /^Dockerfile$/u,
  /^\.dockerignore$/u,
  /^litestream\.yml$/u,
  /^fly\.toml$/u,
  /^drizzle\//u,
  /^scripts\/(?:e2e-ci|create-template-db)\.ts$/u,
  /^scripts\/docker-entrypoint\.sh$/u,
  /^src\/server\/(?:app|main)\.ts$/u,
  /^src\/server\/config\/env\.ts$/u,
  /^src\/server\/platform\/db\//u,
  /^src\/web\/(?:main\.tsx|route-table\.tsx|styles\.css)$/u,
  /^test\/e2e\/(?:global-setup|app-server|app\.fixture|auth\.fixture|identity-server-test\.fixture|sign-in)\.ts$/u,
];

const ignored = [
  /^docs\//u,
  /\.md$/u,
  /^LICENSE$/u,
  /^profile\/README\.md$/u,
  /^design\/reference\/source\//u,
  /^design\/review\//u,
  /^\.oxlintrc\.json$/u,
  /^\.oxfmtrc\.json$/u,
];

function isE2eTestFile(file: string) {
  return file.startsWith("test/e2e/") && file.endsWith(".test.ts");
}

function isUnitTestFile(file: string) {
  return file.startsWith("src/") && file.endsWith(".test.ts");
}

const reachTestSchema = z.object({
  full: z.boolean(),
  paths: z.array(z.string()),
  routes: z.array(z.string()).default([]),
  designs: z.array(z.string()).default([]),
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
  routes: string[];
  designs: string[];
  modules: string[];
}

interface ReportSuite {
  file?: string | undefined;
  specs: z.infer<typeof reportSpecSchema>[];
  suites: ReportSuite[];
}

interface RequestedPath {
  path: string;
  trailingSlash: boolean;
}

interface RouteModuleEntry {
  path: string;
  modules: string[];
}

interface WebRouteEntry {
  urlPath: string;
  routeFile: string;
  shell: "app" | "admin" | "none";
  modules: string[];
}

interface PlanInput {
  changed: readonly string[];
  isMain: boolean;
  shardCount?: number | undefined;
  /** Force the full suite even when the changed files would need only a few shards. */
  full?: boolean | undefined;
  map: z.infer<typeof reachMapSchema>;
  seconds: Record<string, number>;
  allTests: readonly string[];
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

export function extractImportBindings(text: string) {
  const bindings = new Map<string, string>();

  for (const match of text.matchAll(bindingPattern)) {
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

  for (const match of text.matchAll(lazyBindingPattern)) {
    const name = match.groups?.name;
    const specifier = match.groups?.specifier;

    if (name !== undefined && specifier !== undefined) {
      bindings.set(name, specifier);
    }
  }

  return bindings;
}

function importBindings(file: string) {
  return extractImportBindings(textOf(file));
}

function declarationStarts(text: string, includeIndentedHelpers: boolean) {
  const starts: { name: string; index: number }[] = [];

  for (const match of text.matchAll(topDeclarationPattern)) {
    starts.push({ name: match.groups?.name ?? "", index: match.index });
  }

  if (includeIndentedHelpers) {
    for (const match of text.matchAll(helperFunctionPattern)) {
      starts.push({ name: match.groups?.name ?? "", index: match.index });
    }
  }

  return starts.toSorted((left, right) => left.index - right.index);
}

function declarationBlocks(file: string, includeIndentedHelpers = false, excludedName?: string) {
  const text = textOf(file);
  const starts = declarationStarts(text, includeIndentedHelpers);
  const routeMarkers = [...text.matchAll(routeDeclarationPattern)].map((match) => match.index);
  const blocks = new Map<string, string>();

  for (const [position, start] of starts.entries()) {
    if (start.name === excludedName) {
      continue;
    }

    const nextDecl = starts[position + 1]?.index ?? text.length;
    const nextRoute = routeMarkers.find((index) => index > start.index) ?? text.length;
    const end = Math.min(nextDecl, nextRoute);

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

const injectedServices = new Map<string, string>([
  ["matching", "src/server/matching/score.ts"],
  ["reviews", "src/server/pipeline/reviews.ts"],
  ["preparation", "src/server/pipeline/prepare.ts"],
  ["mailboxes", "src/server/inbox/mailboxes.ts"],
  ["personal", "src/server/profile/personal-crypto.ts"],
  ["catalogWorker", "src/server/catalog/sweep-worker-runner.ts"],
  ["consent", "src/server/profile/consent.ts"],
  ["providers", "src/server/dispatch/browser/index.ts"],
]);

const jobHandlerByKind = new Map<string, string[]>([
  ["catalog.", ["catalogJobHandlers"]],
  ["application.prepare", ["preparationJobHandlers"]],
  ["planner.", ["planningJobHandlers"]],
  ["llm.", ["llmJobHandlers"]],
  ["prep.daily", ["prepDailyJobHandlers"]],
  ["ready.", ["readyNotifyJobHandlers"]],
  ["push.", ["pushNotifyJobHandlers"]],
  ["mail.", ["mailJobHandlers"]],
  ["application.send", ["dispatchJobHandlers"]],
  ["dispatch.recover", ["dispatchJobHandlers"]],
  ["dispatch.tick", ["dispatchJobHandlers"]],
  ["fixtures.", ["fixtureJobHandlers"]],
  ["dispatch.watch", ["watchJobHandlers"]],
  ["checkin.", ["checkinJobHandlers"]],
  ["live.", ["liveCheckJobHandlers"]],
  ["test.", ["testJobHandlers"]],
]);

function routeModules(file: string, files: Set<string>, mounts: Map<string, string>) {
  const mount = mounts.get(file) ?? "";
  const bindings = importBindings(file);
  const text = textOf(file);
  const factory = factoryPattern.exec(text)?.groups?.name;
  const blocks = declarationBlocks(file, true, factory);
  const declarations = [...text.matchAll(routeDeclarationPattern)];
  const entries: RouteModuleEntry[] = [];

  for (const [position, declaration] of declarations.entries()) {
    const end = declarations[position + 1]?.index ?? text.length;
    const chunk = text.slice(declaration.index, end);
    const collected = collectBlocks(blocks, identifiersIn(chunk));
    const modules = new Set<string>([file]);

    for (const identifier of collected) {
      const injected = injectedServices.get(identifier);

      if (injected !== undefined && files.has(injected)) {
        modules.add(injected);
      }

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

function allServerRoutes(files: Set<string>) {
  const mounts = routeMounts(files);
  const entries: RouteModuleEntry[] = [];

  for (const file of files) {
    if (file.startsWith("src/server/routes/")) {
      entries.push(...routeModules(file, files, mounts));
    }
  }

  return entries;
}

function segmentsOf(path: string) {
  return path.split("/").filter((part) => part.length > 0);
}

export function routeMatches(
  requested: readonly string[],
  route: readonly string[],
  trailingSlash = false,
) {
  if (route.length === 0) {
    return false;
  }

  const matchesTrailingParam =
    trailingSlash &&
    requested.length >= 2 &&
    requested.length === route.length - 1 &&
    (route.at(-1)?.startsWith(":") ?? false);

  if (!matchesTrailingParam && requested.length !== route.length) {
    return false;
  }

  for (const [position, requestPart] of requested.entries()) {
    const routePart = route[position];

    if (routePart === undefined) {
      return false;
    }

    if (routePart.startsWith(":") || requestPart.startsWith(":")) {
      continue;
    }

    if (routePart !== requestPart) {
      return false;
    }
  }

  return true;
}

export function requestedPathsFromText(text: string) {
  const seen = new Map<string, boolean>();

  for (const quoted of text.matchAll(quotedStringPattern)) {
    const normalized = (quoted.groups?.raw ?? "").replaceAll(/\$\{[^}]+\}/gu, ":param");

    for (const match of normalized.matchAll(pathTokenPattern)) {
      const [rawToken] = match;
      const trailingSlash = rawToken.length > 1 && rawToken.endsWith("/");
      const path = trailingSlash ? rawToken.slice(0, -1) : rawToken;

      seen.set(path, (seen.get(path) ?? false) || trailingSlash);
    }
  }

  return [...seen.entries()]
    .map(([path, trailingSlash]) => ({ path, trailingSlash }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function isReachModule(file: string) {
  return (
    file.startsWith("src/") &&
    !file.startsWith("src/server/platform/db/") &&
    file !== "src/server/app.ts" &&
    file !== "src/server/main.ts" &&
    file !== "src/server/config/env.ts" &&
    file !== "src/web/main.tsx" &&
    file !== "src/web/route-table.tsx"
  );
}

function jobHandlerModules(files: Set<string>, combinedText: string) {
  const file = "src/server/main.ts";
  const bindings = importBindings(file);
  const blocks = declarationBlocks(file);
  const roots = new Set<string>();

  for (const [prefix, handlers] of jobHandlerByKind) {
    if (combinedText.includes(prefix)) {
      for (const handler of handlers) {
        roots.add(handler);
      }
    }
  }

  if (roots.size === 0) {
    for (const handlers of jobHandlerByKind.values()) {
      for (const handler of handlers) {
        roots.add(handler);
      }
    }
  }

  const used = collectBlocks(blocks, roots);
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

function shellForRoute(urlPath: string) {
  if (urlPath.startsWith("/admin")) {
    return "admin" as const;
  }

  if (
    urlPath === "*" ||
    urlPath === "/home" ||
    urlPath === "/ready" ||
    urlPath === "/board" ||
    urlPath === "/tracker" ||
    urlPath === "/applications" ||
    urlPath === "/search" ||
    urlPath === "/review" ||
    urlPath === "/calendar" ||
    urlPath === "/inbox" ||
    urlPath === "/inbox/:id" ||
    urlPath === "/inbox/address" ||
    urlPath === "/notifications" ||
    urlPath === "/profile" ||
    urlPath.startsWith("/profile/") ||
    urlPath === "/settings" ||
    urlPath.startsWith("/settings/") ||
    urlPath === "/support"
  ) {
    return "app" as const;
  }

  return "none" as const;
}

export function webRouteEntries(
  graph: Map<string, string[]>,
  files: Set<string>,
  serverRoutes: readonly RouteModuleEntry[],
) {
  const mainFile = "src/web/route-table.tsx";
  const bindings = importBindings(mainFile);
  const text = textOf(mainFile);
  const entries: WebRouteEntry[] = [];

  for (const match of text.matchAll(webRouteEntryPattern)) {
    const urlPath = match.groups?.path;
    const component = match.groups?.component;

    if (urlPath === undefined || component === undefined) {
      continue;
    }

    const specifier = bindings.get(component);
    const routeFile = specifier === undefined ? null : resolveSpecifier(mainFile, specifier, files);

    if (routeFile === null) {
      continue;
    }

    const shell = shellForRoute(urlPath);
    const roots = [routeFile];

    if (shell === "app") {
      roots.push("src/web/app.tsx");
    } else if (shell === "admin") {
      roots.push("src/web/routes/admin/shell.tsx");
    }

    const webModules = closureFrom(graph, roots);
    const apiRoots = new Set<string>();

    for (const webFile of webModules) {
      for (const req of requestedPathsFromText(textOf(webFile))) {
        if (!req.path.startsWith("/api/") && !req.path.startsWith("/admin/api/")) {
          continue;
        }

        const requestedSegments = segmentsOf(req.path);

        for (const serverEntry of serverRoutes) {
          if (routeMatches(requestedSegments, segmentsOf(serverEntry.path), req.trailingSlash)) {
            for (const module of serverEntry.modules) {
              apiRoots.add(module);
            }
          }
        }
      }
    }

    const modules = new Set<string>();

    for (const module of webModules) {
      if (isReachModule(module)) {
        modules.add(module);
      }
    }

    for (const module of closureFrom(graph, [...apiRoots])) {
      if (isReachModule(module)) {
        modules.add(module);
      }
    }

    entries.push({
      urlPath,
      routeFile,
      shell,
      modules: [...modules].toSorted((left, right) => left.localeCompare(right)),
    });
  }

  for (const match of text.matchAll(redirectRouteEntryPattern)) {
    const urlPath = match.groups?.path;
    const to = match.groups?.to;

    if (urlPath === undefined || to === undefined) {
      continue;
    }

    const [rawTarget = ""] = to.split(/[?#]/u);
    const targetPath = rawTarget === "" ? "/" : rawTarget;
    const target = entries.find((candidate) => candidate.urlPath === targetPath);

    if (target === undefined) {
      continue;
    }

    const modules = new Set<string>(target.modules);
    const redirectFile = "src/web/components/preserve-search-redirect.tsx";

    if (files.has(redirectFile)) {
      modules.add(redirectFile);
    }

    entries.push({
      urlPath,
      routeFile: target.routeFile,
      shell: shellForRoute(urlPath),
      modules: [...modules].toSorted((left, right) => left.localeCompare(right)),
    });
  }

  return entries;
}

function collectE2eSlices(testFile: string, files: Set<string>) {
  const texts: string[] = [textOf(testFile)];
  const helperFiles = new Set<string>();
  const pending: { file: string; used: Set<string> }[] = [];

  const directBindings = importBindings(testFile);
  const directText = texts[0] ?? "";

  for (const [identifier, specifier] of directBindings) {
    const resolved = resolveSpecifier(testFile, specifier, files);

    if (resolved !== null && resolved.startsWith("test/e2e/") && directText.includes(identifier)) {
      pending.push({ file: resolved, used: new Set([identifier]) });
    }
  }

  const visited = new Map<string, Set<string>>();

  while (pending.length > 0) {
    const next = pending.pop();

    if (next === undefined) {
      continue;
    }

    const seenForFile = visited.get(next.file) ?? new Set<string>();
    const fresh: string[] = [];

    for (const identifier of next.used) {
      if (!seenForFile.has(identifier)) {
        seenForFile.add(identifier);
        fresh.push(identifier);
      }
    }

    visited.set(next.file, seenForFile);

    if (fresh.length === 0) {
      continue;
    }

    helperFiles.add(next.file);

    const blocks = declarationBlocks(next.file);
    const bindings = importBindings(next.file);
    const collectedIds = collectBlocks(blocks, fresh);
    let hasBlock = false;

    for (const name of fresh) {
      const block = blocks.get(name);

      if (block !== undefined) {
        hasBlock = true;
        texts.push(block);
      }
    }

    if (!hasBlock) {
      texts.push(textOf(next.file));
    }

    for (const identifier of collectedIds) {
      const block = blocks.get(identifier);

      if (block !== undefined) {
        texts.push(block);
      }

      const specifier = bindings.get(identifier);

      if (specifier === undefined) {
        continue;
      }

      const resolved = resolveSpecifier(next.file, specifier, files);

      if (resolved?.startsWith("test/e2e/")) {
        pending.push({ file: resolved, used: new Set([identifier]) });
      }
    }
  }

  return { texts, helperFiles };
}

function playwrightDesignDirs() {
  const text = textOf("playwright.config.ts");
  const mappings: { pattern: RegExp; dir: string }[] = [];

  for (const match of text.matchAll(playwrightProjectPattern)) {
    const rawPattern = match.groups?.match;
    const dir = match.groups?.dir;

    if (rawPattern !== undefined && dir !== undefined) {
      mappings.push({ pattern: new RegExp(rawPattern, "u"), dir: `design/reference/${dir}/` });
    }
  }

  return mappings;
}

const uiPathArrayPattern = /(?:adminPaths|path:)\s*(?:\[[\s\S]{0,400}?\]|"[^"]+")/gu;

function visitedUiRoutes(
  testFile: string,
  texts: readonly string[],
  knownRoutes: readonly WebRouteEntry[],
) {
  const routes = new Set<string>();
  const knownPaths = new Set(knownRoutes.map((entry) => entry.urlPath));
  const combined = texts.join("\n");

  for (const match of combined.matchAll(gotoPathPattern)) {
    const rawPath = match.groups?.path?.replaceAll(/\$\{[^}]+\}/gu, ":param");

    if (rawPath === undefined || rawPath.startsWith("/api") || rawPath.startsWith("/__")) {
      continue;
    }

    if (knownPaths.has(rawPath)) {
      routes.add(rawPath);
      continue;
    }

    if (rawPath.startsWith("/admin/users/")) {
      routes.add("/admin/users/:id");
      continue;
    }

    if (rawPath.startsWith("/inbox/")) {
      routes.add("/inbox/:id");
      continue;
    }

    const route = knownRoutes.find((entry) =>
      routeMatches(
        rawPath.split("/").filter((part) => part.length > 0),
        entry.urlPath.split("/").filter((part) => part.length > 0),
        false,
      ),
    );

    if (route !== undefined) {
      routes.add(route.urlPath);
    } else if (rawPath === "/missing-route" && knownPaths.has("*")) {
      routes.add("*");
    }
  }

  for (const match of combined.matchAll(billingUserRoutePattern)) {
    routes.add("/admin/billing/users/:id");

    if (match.groups?.refund !== undefined) {
      routes.add("/admin/billing/users/:id/refund");
    }
  }

  for (const arrayMatch of combined.matchAll(uiPathArrayPattern)) {
    for (const req of requestedPathsFromText(arrayMatch[0])) {
      if (knownPaths.has(req.path)) {
        routes.add(req.path);
      }
    }
  }

  if (combined.includes('"/terms", "/privacy"')) {
    routes.add("/terms");
    routes.add("/privacy");
  }

  if (combined.includes("openBoard(")) {
    routes.add("/applications");
  }

  if (combined.includes("openAdminAsOwner(") || combined.includes("signInOwnerOnAdmin(")) {
    routes.add("/admin");
  }

  if (testFile.endsWith("board-match-shell.test.ts")) {
    routes.add("/");
  }

  return [...routes].toSorted((left, right) => left.localeCompare(right));
}

function testDesigns(
  testFile: string,
  texts: readonly string[],
  playwrightMappings: readonly { pattern: RegExp; dir: string }[],
) {
  const designs = new Set<string>();
  const name = basename(testFile);

  for (const mapping of playwrightMappings) {
    if (mapping.pattern.test(name)) {
      designs.add(mapping.dir);
    }
  }

  for (const text of texts) {
    for (const match of text.matchAll(designRefPattern)) {
      const dir = match.groups?.dir;

      if (dir !== undefined) {
        designs.add(`design/reference/${dir}/`);
      }
    }
  }

  return [...designs].toSorted((left, right) => left.localeCompare(right));
}

function testReach(
  testFile: string,
  graph: Map<string, string[]>,
  files: Set<string>,
  serverRoutes: readonly RouteModuleEntry[],
  webRoutes: readonly WebRouteEntry[],
  playwrightMappings: readonly { pattern: RegExp; dir: string }[],
) {
  const reachable = closureFrom(graph, [testFile]);
  const directModules = [...reachable].filter((file) => isReachModule(file));
  const { texts, helperFiles } = collectE2eSlices(testFile, files);
  const paths: RequestedPath[] = [];

  for (const text of texts) {
    paths.push(...requestedPathsFromText(text));
  }

  const routeRoots = new Set<string>();
  const matchedPaths = new Set<string>();

  for (const req of paths) {
    const requested = segmentsOf(req.path);

    for (const entry of serverRoutes) {
      if (routeMatches(requested, segmentsOf(entry.path), req.trailingSlash)) {
        matchedPaths.add(req.path);

        for (const module of entry.modules) {
          routeRoots.add(module);
        }
      }
    }
  }

  if (paths.some((req) => jobRoutePattern.test(req.path))) {
    for (const module of jobHandlerModules(files, texts.join("\n"))) {
      routeRoots.add(module);
    }
  }

  const modules = new Set<string>(directModules);

  for (const helper of helperFiles) {
    if (!isAlwaysFull(helper)) {
      modules.add(helper);
    }
  }

  for (const module of closureFrom(graph, [...routeRoots])) {
    if (isReachModule(module)) {
      modules.add(module);
    }
  }

  const uiRoutes = visitedUiRoutes(testFile, texts, webRoutes);

  for (const uiRoute of uiRoutes) {
    const entry = webRoutes.find((candidate) => candidate.urlPath === uiRoute);

    if (entry !== undefined) {
      for (const module of entry.modules) {
        modules.add(module);
      }
    }
  }

  const designs = testDesigns(testFile, texts, playwrightMappings);

  return {
    full: false,
    paths: [...matchedPaths].toSorted((left, right) => left.localeCompare(right)),
    routes: uiRoutes,
    designs,
    modules: [...modules].toSorted((left, right) => left.localeCompare(right)),
  };
}

export function buildReachMap() {
  const files = listSources();
  const graph = buildGraph(files);
  const known = new Set(files);
  const serverRoutes = allServerRoutes(known);
  const webRoutes = webRouteEntries(graph, known, serverRoutes);
  const playwrightMappings = playwrightDesignDirs();
  const tests: Record<string, ReachTest> = {};

  for (const file of files) {
    if (file.startsWith("test/e2e/") && file.endsWith(".test.ts")) {
      tests[file] = testReach(file, graph, known, serverRoutes, webRoutes, playwrightMappings);
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

function reportFilePath(named: string, testFiles: readonly string[]) {
  const withoutRoot = named.replace(`${root}/`, "");

  if (testFiles.includes(withoutRoot)) {
    return withoutRoot;
  }

  return testFiles.find((file) => file.endsWith(`/${withoutRoot}`)) ?? withoutRoot;
}

function mergeReport(file: string, seconds: Map<string, number>, testFiles: readonly string[]) {
  const report = reportSchema.parse(JSON.parse(readFileSync(file, "utf8")));

  function visit(suite: ReportSuite, inherited: string | undefined) {
    const named = suite.file ?? inherited;
    const fileOfSuite = named === undefined ? undefined : reportFilePath(named, testFiles);

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
  const testFiles = [...new Glob("test/e2e/**/*.test.ts").scanSync({ cwd: root })];

  for (const file of new Glob("**/*.json").scanSync({ cwd: directory })) {
    mergeReport(join(directory, file), measured, testFiles);
  }

  const entries: [string, number][] = Object.entries(readTimings().seconds);

  for (const [file, value] of measured) {
    entries.push([file, Math.round(value * 10) / 10]);
  }

  const seconds = Object.fromEntries(
    entries.filter(([file, value]) => value > 0 && existsSync(localPath(file))),
  );

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

function isKnownDesign(map: z.infer<typeof reachMapSchema>, file: string) {
  return Object.values(map.tests).some((test) =>
    test.designs.some((prefix) => file.startsWith(prefix)),
  );
}

function fullByRule(touched: readonly string[]) {
  return touched.some((file) => isAlwaysFull(file));
}

function fullByUnknown(map: z.infer<typeof reachMapSchema>, touched: readonly string[]) {
  return touched.some(
    (file) =>
      !isAlwaysFull(file) &&
      !isE2eTestFile(file) &&
      !isUnitTestFile(file) &&
      map.tests[file] === undefined &&
      !isKnownModule(map, file) &&
      !isKnownDesign(map, file),
  );
}

function selectionReason(
  isMain: boolean,
  rule: boolean,
  unknown: boolean,
  touched: number,
  selected: number,
  total: number,
) {
  if (isMain) {
    return "a push to main runs the full suite";
  }

  if (touched === 0) {
    return "the diff touches only documentation or lint/format config, so no e2e file runs";
  }

  if (rule) {
    return "the diff touches global config, db schema, shell entrypoints or global test harness, so it runs everything";
  }

  if (unknown) {
    return "the diff reaches a file the map cannot classify, so it runs everything";
  }

  return `${String(selected)} of ${String(total)} files are reachable from the diff`;
}

function selectedLoadSeconds(files: readonly string[], seconds: Record<string, number>) {
  const fallback = defaultSeconds(seconds);
  let total = 0;

  for (const file of files) {
    total += seconds[file] ?? fallback;
  }

  return total;
}

function resolveShardCount(
  explicit: number | null,
  selected: readonly string[],
  seconds: Record<string, number>,
) {
  if (explicit !== null) {
    return explicit;
  }

  if (selected.length === 0) {
    return 1;
  }

  const total = selectedLoadSeconds(selected, seconds);

  return Math.min(12, selected.length, Math.max(1, Math.ceil(total / 40)));
}

/**
 * Whether a shard's files, or any helper they import, mention a marker such as a required binary. The e2e workflow
 * uses it to install stripe-mock only on the shards whose tests can reach it.
 * @param files The test files in the shard.
 * @param marker The text a file must contain, for example `stripe-mock`.
 * @returns True when the file or one of its imports contains the marker.
 */
export function shardNeedsMarker(files: readonly string[], marker: string) {
  const graph = buildGraph(listSources());

  for (const file of closureFrom(graph, files)) {
    if (existsSync(localPath(file)) && textOf(file).includes(marker)) {
      return true;
    }
  }

  return false;
}

/**
 * Splits a comma-separated label list from the workflow, trimming and lowercasing each name.
 * @param value The label names, for example `bug, high-risk`.
 * @returns The normalized labels, without empty entries.
 */
export function parseLabels(value: string): string[] {
  return value
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .filter((label) => label.length > 0);
}

/**
 * Whether a pull request carries the `high-risk` label, which forces the full e2e suite instead of the delta shards.
 * @param labels The pull request labels.
 * @returns True when `high-risk` is present.
 */
export function hasHighRiskLabel(labels: readonly string[]): boolean {
  return labels.some((label) => label === "high-risk");
}

export function computePlan(input: PlanInput) {
  const { changed, full: requestedFull, isMain, shardCount, map, seconds, allTests } = input;

  const changedTests = new Set(
    changed.filter((file) => isE2eTestFile(file) && existsSync(localPath(file))),
  );

  const touched = changed.filter((file) => !isIgnored(file));

  const testsOnly =
    touched.length > 0 && touched.every((file) => isE2eTestFile(file) || isUnitTestFile(file));

  const emptyMap = Object.keys(map.tests).length === 0;
  const rule = !testsOnly && (emptyMap || fullByRule(touched));
  const unknown = !testsOnly && fullByUnknown(map, touched);
  const full = requestedFull === true || isMain || rule || unknown;

  let selected = allTests.filter((test) => {
    const reach = map.tests[test];

    if (changedTests.has(test) || reach === undefined) {
      return true;
    }

    if (testsOnly) {
      return false;
    }

    return (
      reach.full ||
      reach.modules.some((module) => touched.includes(module)) ||
      reach.designs.some((prefix) => touched.some((file) => file.startsWith(prefix)))
    );
  });

  if (full) {
    selected = [...allTests];
  }

  if (touched.length === 0 && !isMain) {
    selected = [];
  }

  const container =
    isMain || touched.some((file) => containerPatterns.some((pattern) => pattern.test(file)));

  const effectiveShards = resolveShardCount(shardCount ?? null, selected, seconds);

  return planSchema.parse({
    version: 1,
    full,
    container,
    reason:
      requestedFull === true
        ? "the high-risk label runs the full suite"
        : selectionReason(isMain, rule, unknown, touched.length, selected.length, allTests.length),
    selected,
    shards: assignShards(selected, seconds, effectiveShards),
  });
}

function plan() {
  const base = flagValue("--base");
  const explicitShards = flagValue("--shards");
  const labels = parseLabels(flagValue("--labels") ?? "");
  const output = flagValue("--out");
  const map = readReachMap();
  const changed = base === null ? [] : changedFiles(base);
  const knownTests = new Glob("test/e2e/**/*.test.ts").scanSync({ cwd: root });

  const changedTests = changed.filter((file) => isE2eTestFile(file) && existsSync(localPath(file)));

  const allTests = [
    ...new Set([...knownTests, ...Object.keys(map.tests), ...changedTests]),
  ].toSorted((left, right) => left.localeCompare(right));

  const planBody = computePlan({
    changed,
    full: hasHighRiskLabel(labels),
    isMain: base === null,
    shardCount: explicitShards === null ? undefined : Number(explicitShards),
    map,
    seconds: readTimings().seconds,
    allTests,
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

if (import.meta.main) {
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

    case "needs": {
      const planPath = localPath(flagValue("--plan") ?? "e2e-plan.json");
      const shardNumber = Number(flagValue("--shard") ?? "1");
      const marker = flagValue("--marker");

      if (marker === null) {
        throw new Error("needs requires --marker");
      }

      const planBody = planSchema.parse(JSON.parse(readFileSync(planPath, "utf8")));
      const shard = planBody.shards.find((entry) => entry.shard === shardNumber);
      const needed = shardNeedsMarker(shard?.files ?? [], marker);

      process.stdout.write(`${needed ? "true" : "false"}\n`);
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
      throw new Error("usage: bun run scripts/e2e-ci.ts <map|timings|plan|shard|needs> [flags]");
    }
  }
}
