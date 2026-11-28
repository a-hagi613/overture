import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { MARKETING_BUILD_ROOT } from "../../src/shared/marketing-paths.ts";
import { STATIC_ASSET_SECURITY_HEADERS as staticAssetSecurityHeaders } from "../../src/shared/security-headers.ts";

export { PRERENDERED_MARKETING_PATHS } from "../../src/shared/marketing-paths.ts";

export { STATIC_ASSET_SECURITY_HEADERS } from "../../src/shared/security-headers.ts";

const configSchema = z.object({
  name: z.string(),
  main: z.string().nullish(),
  assets: z.object({
    directory: z.string(),
    html_handling: z.string(),
    not_found_handling: z.string(),
  }),
  routes: z.array(z.object({ pattern: z.string(), zone_name: z.string() })),
  workers_dev: z.boolean(),
});

export const marketingRoot = join(process.cwd(), MARKETING_BUILD_ROOT);

export function marketingConfig() {
  return configSchema.parse(
    Bun.JSONC.parse(readFileSync("workers/marketing/wrangler.jsonc", "utf8")),
  );
}

function assetFile(root: string, pathname: string) {
  const relative = pathname.replaceAll(/^\/+|\/+$/gu, "");

  if (relative.split("/").includes("..")) {
    return null;
  }

  const candidates =
    relative === "" ? ["index.html"] : [relative, `${relative}.html`, join(relative, "index.html")];

  return (
    candidates
      .map((candidate) => join(root, candidate))
      .find((file) => existsSync(file) && statSync(file).isFile()) ?? null
  );
}

export function startAssetLayer(root: string) {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      const file = assetFile(root, pathname);

      if (file === null) {
        return new Response("not found", { status: 404 });
      }

      return new Response(Bun.file(file));
    },
  });

  return {
    base: `http://127.0.0.1:${String(server.port)}`,
    stop: async () => {
      await server.stop(true);
    },
  };
}

export function startOrigin() {
  let hits = 0;

  const server = Bun.serve({
    port: 0,
    fetch() {
      hits += 1;

      return new Response("origin down", { status: 503 });
    },
  });

  return {
    base: `http://127.0.0.1:${String(server.port)}`,
    hits: () => hits,
    stop: async () => {
      await server.stop(true);
    },
  };
}

/**
 * Wires the deployed shape of the landing into one origin: `/` answers from `dist-marketing/index.html` with the
 * Worker's security headers, and every other path (the `/assets/*` bundle, the manifest, previews) goes
 * to the app exactly as Cloudflare's route for `tryoverture.com/` forwards it. Serving the marketing HTML against the
 * app's own bundle is what the production 404 broke: a page from a second build referenced a `main-*.js` the origin
 * never had, so React never hydrated.
 * @param origin The app server that serves the assets and API.
 * @returns The landing origin and a stop handle.
 */
export function startMarketingSite(origin: string) {
  const page = readFileSync(join(marketingRoot, "index.html"), "utf8");

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/" && request.method === "GET") {
        return new Response(page, {
          headers: {
            ...staticAssetSecurityHeaders,
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      const upstream = await fetch(`${origin}${url.pathname}${url.search}`, {
        headers: { accept: request.headers.get("accept") ?? "*/*" },
        method: request.method,
        redirect: "manual",
      });

      return new Response(upstream.body, {
        headers: upstream.headers,
        status: upstream.status,
      });
    },
  });

  return {
    base: `http://127.0.0.1:${String(server.port)}`,
    stop: async () => {
      await server.stop(true);
    },
  };
}
