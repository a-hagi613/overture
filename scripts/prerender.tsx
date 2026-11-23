import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import {
  MARKETING_BUILD_ROOT,
  PRERENDERED_MARKETING_PATHS,
} from "../src/shared/marketing-paths.ts";
import { STATIC_ASSET_SECURITY_HEADERS } from "../src/shared/security-headers.ts";
import { LandingPage } from "../src/web/routes/landing.tsx";

const rootMarker = '<div id="root"></div>';
const dist = join(process.cwd(), "dist");
const marketingRoot = join(process.cwd(), MARKETING_BUILD_ROOT);
const shellPath = join(dist, "index.html");

const renderers = new Map<string, () => string>([
  ["/", () => renderToStaticMarkup(<LandingPage />)],
]);

if (!existsSync(shellPath)) {
  throw new Error("prerender: dist/index.html is missing; run `vite build` first.");
}

const shell = readFileSync(shellPath, "utf8");

if (!shell.includes(rootMarker)) {
  throw new Error(`prerender: ${rootMarker} is missing from dist/index.html.`);
}

function withMarkup(markup: string) {
  return shell.replace(rootMarker, () => `<div id="root">${markup}</div>`);
}

function writePage(root: string, path: string, html: string) {
  const relative = path.replace(/^\//u, "");
  const file = relative === "" ? join(root, "index.html") : join(root, relative, "index.html");

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

function standalonePage(html: string) {
  return html.replaceAll(
    /<link\b[^>]*href="(?<href>\/assets\/[^"]+\.css)"[^>]*>/gu,
    (_tag, href: string) => `<style>${readFileSync(join(dist, href.slice(1)), "utf8")}</style>`,
  );
}

function headersFile() {
  const lines = ["/*"];

  for (const [name, value] of Object.entries(STATIC_ASSET_SECURITY_HEADERS)) {
    lines.push(`  ${name}: ${value}`);
  }

  return `${lines.join("\n")}\n`;
}

writeFileSync(join(dist, "app-shell.html"), shell);

rmSync(marketingRoot, { force: true, recursive: true });

mkdirSync(marketingRoot, { recursive: true });

copyFileSync(join(dist, "theme-boot.js"), join(marketingRoot, "theme-boot.js"));

for (const path of PRERENDERED_MARKETING_PATHS) {
  const render = renderers.get(path);

  if (render === undefined) {
    throw new Error(`prerender: no page component renders ${path}.`);
  }

  const page = withMarkup(render());

  writePage(dist, path, page);
  writePage(marketingRoot, path, standalonePage(page));
}

writeFileSync(join(marketingRoot, "_headers"), headersFile());

process.stdout.write(
  `prerender: wrote dist/index.html, dist/app-shell.html, ${MARKETING_BUILD_ROOT}/\n`,
);
