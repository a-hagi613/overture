import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

Bun.env.BETTER_AUTH_SECRET ??= "app-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { serviceWorkerResponse, staticCacheHeaders, staticResponseFrom } = await import("./app.ts");

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function staticRoot() {
  const directory = mkdtempSync(join(tmpdir(), "app-static-"));

  scratchDirectories.push(directory);

  writeFileSync(join(directory, "app-shell.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(directory, "index.html"), "<!doctype html><title>index</title>");
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "assets", "app-123.js"), "console.log('app');");

  return directory;
}

test("a missing hashed asset answers 404 instead of the app shell", async () => {
  const root = staticRoot();

  const asset = await staticResponseFrom(root, "http://localhost/assets/missing-456.js");

  expect(asset?.status).toBe(404);
  expect(await asset?.text()).toBe("Not found");

  const serviceWorker = await staticResponseFrom(root, "http://localhost/sw.js");

  expect(serviceWorker?.status).toBe(404);
});

test("a hashed asset is cached forever and the shell never is", async () => {
  const root = staticRoot();

  const asset = await staticResponseFrom(root, "http://localhost/assets/app-123.js");

  expect(asset?.status).toBe(200);
  expect(asset?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");

  const route = await staticResponseFrom(root, "http://localhost/settings");

  expect(route?.status).toBe(200);
  expect(route?.headers.get("Cache-Control")).toBe("no-cache");
  expect(await route?.text()).toContain("shell");

  const index = await staticResponseFrom(root, "http://localhost/");

  expect(index?.headers.get("Cache-Control")).toBe("no-cache");
});

test("the cache policy only marks hashed files immutable and configures edge caching for videos and icons", () => {
  expect(staticCacheHeaders("/assets/app-123.js")).toEqual({
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  expect(staticCacheHeaders("/videos/workspace-demo-desktop.mp4")).toEqual({
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "CDN-Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400",
  });
  expect(staticCacheHeaders("/videos/workspace-demo-desktop-poster.png")).toEqual({
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "CDN-Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400",
  });
  expect(staticCacheHeaders("/icons/icon-192.png")).toEqual({
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "CDN-Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
  });
  expect(staticCacheHeaders("/favicon.svg")).toEqual({
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "CDN-Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
  });
  expect(staticCacheHeaders("/manifest.webmanifest")).toEqual({
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "CDN-Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
  });
  expect(staticCacheHeaders("/sw.js")).toEqual({
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "CDN-Cache-Control": "no-store",
  });
  expect(staticCacheHeaders("/app-shell.html")).toEqual({ "Cache-Control": "no-cache" });
  expect(staticCacheHeaders("/favicon.ico")).toBeUndefined();
});

test("static assets advertise byte ranges and slice video bytes with 206 and 416", async () => {
  const root = staticRoot();

  mkdirSync(join(root, "videos"));
  writeFileSync(join(root, "videos", "demo.mp4"), "0123456789");

  const full = await staticResponseFrom(root, "http://localhost/videos/demo.mp4");

  expect(full?.status).toBe(200);
  expect(full?.headers.get("Accept-Ranges")).toBe("bytes");
  expect(full?.headers.get("CDN-Cache-Control")).toBe(
    "public, max-age=2592000, stale-while-revalidate=86400",
  );

  const partial = await staticResponseFrom(root, "http://localhost/videos/demo.mp4", "bytes=0-3");

  expect(partial?.status).toBe(206);
  expect(partial?.headers.get("Accept-Ranges")).toBe("bytes");
  expect(partial?.headers.get("Content-Range")).toBe("bytes 0-3/10");
  expect(partial?.headers.get("Content-Length")).toBe("4");
  expect(partial?.headers.get("CDN-Cache-Control")).toBe(
    "public, max-age=2592000, stale-while-revalidate=86400",
  );
  expect(await partial?.text()).toBe("0123");

  const suffix = await staticResponseFrom(root, "http://localhost/videos/demo.mp4", "bytes=-3");

  expect(suffix?.status).toBe(206);
  expect(suffix?.headers.get("Content-Range")).toBe("bytes 7-9/10");
  expect(await suffix?.text()).toBe("789");

  const unsatisfiable = await staticResponseFrom(
    root,
    "http://localhost/videos/demo.mp4",
    "bytes=999-1000",
  );

  expect(unsatisfiable?.status).toBe(416);
  expect(unsatisfiable?.headers.get("Content-Range")).toBe("bytes */10");
  expect(unsatisfiable?.headers.get("Accept-Ranges")).toBe("bytes");
});

test("the extensionless service worker is served uncached from the build root", async () => {
  const root = staticRoot();

  writeFileSync(join(root, "sw.js"), "self.addEventListener('install', () => {});");

  const worker = await serviceWorkerResponse(root);

  expect(worker.status).toBe(200);
  expect(worker.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
  expect(worker.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  expect(worker.headers.get("CDN-Cache-Control")).toBe("no-store");
  expect(worker.headers.get("Pragma")).toBe("no-cache");
  expect(worker.headers.get("Service-Worker-Allowed")).toBe("/");
  expect(worker.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await worker.text()).toContain("addEventListener");
});

test("the extensionless service worker answers a plain 404 before a build", async () => {
  const worker = await serviceWorkerResponse(staticRoot());

  expect(worker.status).toBe(404);
  expect(worker.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  expect(worker.headers.get("Cache-Control")).toBe("no-store");
  expect(await worker.text()).toBe("Not found");
});

test("the /sw.js alias is served with the same no-store cache contract", async () => {
  const root = staticRoot();

  writeFileSync(join(root, "sw.js"), "self.addEventListener('install', () => {});");

  const worker = await staticResponseFrom(root, "http://localhost/sw.js");

  expect(worker?.status).toBe(200);
  expect(worker?.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  expect(worker?.headers.get("CDN-Cache-Control")).toBe("no-store");
  expect(await worker?.text()).toContain("addEventListener");
});

test("the app registers the extensionless service worker", () => {
  const main = readFileSync("src/web/main.tsx", "utf8");

  expect(main).toContain('navigator.serviceWorker.register("/sw", { type: "module" })');
  expect(main).not.toContain('navigator.serviceWorker.register("/sw.js"');
});
