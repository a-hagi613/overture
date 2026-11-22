import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { LandingPage } from "../src/web/routes/landing.tsx";
import { PricingPage } from "../src/web/routes/pricing.tsx";

const rootMarker = '<div id="root"></div>';
const dist = join(process.cwd(), "dist");
const shellPath = join(dist, "index.html");

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

const landing = renderToStaticMarkup(<LandingPage />);
const pricing = renderToStaticMarkup(<PricingPage />);

writeFileSync(join(dist, "app-shell.html"), shell);

writeFileSync(join(dist, "index.html"), withMarkup(landing));

mkdirSync(join(dist, "pricing"), { recursive: true });

writeFileSync(join(dist, "pricing", "index.html"), withMarkup(pricing));

process.stdout.write(
  "prerender: wrote dist/index.html, dist/pricing/index.html, dist/app-shell.html\n",
);
