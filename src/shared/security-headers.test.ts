import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "bun:test";
import { z } from "zod";

import { CONTENT_SECURITY_POLICY, STATIC_ASSET_SECURITY_HEADERS } from "./security-headers.ts";

const inlineScriptSchema = z.object({
  code: z.string().min(1),
});

function themeBootScript(html: string) {
  const open = html.indexOf("<script>");
  const close = html.indexOf("</script>", open);

  const parsed = inlineScriptSchema.safeParse({
    code: open === -1 || close === -1 ? "" : html.slice(open + "<script>".length, close),
  });

  if (!parsed.success) {
    throw new Error("index.html has no inline theme boot script.");
  }

  return parsed.data.code;
}

function themeBootHash(code: string) {
  return `sha256-${createHash("sha256").update(code, "utf8").digest("base64")}`;
}

test("the inline theme boot script is admitted by the CSP hash on the app and marketing", () => {
  const shell = readFileSync("index.html", "utf8");
  const hash = themeBootHash(themeBootScript(shell));

  expect(CONTENT_SECURITY_POLICY).toContain(`'${hash}'`);
  expect(STATIC_ASSET_SECURITY_HEADERS["Content-Security-Policy"]).toContain(`'${hash}'`);
});

test("the shell never asks an origin for the theme boot", () => {
  const shell = readFileSync("index.html", "utf8");

  expect(shell).not.toContain("theme-boot.js");
});

function directive(name: string) {
  return CONTENT_SECURITY_POLICY.split("; ")
    .find((entry) => entry.startsWith(`${name} `))
    ?.slice(name.length + 1);
}

test("the CSP admits Cloudflare Web Analytics, which the zone injects into every page", () => {
  expect(directive("script-src")).toContain("https://static.cloudflareinsights.com");
  expect(directive("connect-src")).toContain("https://cloudflareinsights.com");
});

test("admitting the analytics beacon does not widen script execution beyond those origins", () => {
  const script = directive("script-src") ?? "";

  const origins = script
    .split(" ")
    .filter((token) => token !== "")
    .filter((token) => token !== "'self'" && !token.startsWith("'sha256-"));

  expect(origins.toSorted()).toStrictEqual([
    "https://challenges.cloudflare.com",
    "https://static.cloudflareinsights.com",
  ]);
  expect(script).not.toContain("'unsafe-inline'");
  expect(script).not.toContain("'unsafe-eval'");
  expect(script).not.toContain("https://*");
});
