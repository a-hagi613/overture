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
