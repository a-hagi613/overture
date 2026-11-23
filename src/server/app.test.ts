import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

Bun.env.BETTER_AUTH_SECRET ??= "app-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { staticCacheHeaders, staticResponseFrom } = await import("./app.ts");

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

test("the cache policy only marks hashed files immutable", () => {
  expect(staticCacheHeaders("/assets/app-123.js")).toEqual({
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  expect(staticCacheHeaders("/sw.js")).toEqual({ "Cache-Control": "no-cache" });
  expect(staticCacheHeaders("/app-shell.html")).toEqual({ "Cache-Control": "no-cache" });
  expect(staticCacheHeaders("/favicon.ico")).toBeUndefined();
});
