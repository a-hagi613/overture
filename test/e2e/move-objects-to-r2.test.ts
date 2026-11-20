import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "./app.fixture.ts";
import { serverEnvironment } from "./app-server.ts";
import { startS3Server, storedObjectPath } from "./s3-server.ts";

const BUCKET = "overture-files";

const OBJECTS = [
  ["files/owner/resume/one.pdf.enc", "v1:1:first-sealed-value"],
  ["files/owner/mail/two.eml.enc", "v1:1:second-sealed-value"],
] as const;

async function runMove(s3Url: string, root: string, ...flags: string[]) {
  const child = Bun.spawn({
    cmd: ["bun", "run", "scripts/move-objects-to-r2.ts", ...flags],
    env: serverEnvironment({
      OBJECT_STORE_ROOT: root,
      R2_ACCOUNT_ID: "e2e-account",
      R2_ACCESS_KEY_ID: "e2e-access-key",
      R2_SECRET_ACCESS_KEY: "e2e-secret-key",
      R2_BUCKET_FILES: BUCKET,
      R2_ENDPOINT: s3Url,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { stdout, stderr, exitCode };
}

test("move-objects-to-r2 copies every object, verifies sha256, and keeps the local files", async () => {
  const s3 = startS3Server();
  const root = mkdtempSync(join(tmpdir(), "overture-move-"));

  for (const [key, contents] of OBJECTS) {
    const path = join(root, key);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }

  try {
    const dryRun = await runMove(s3.url, root, "--dry-run");

    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain("would copy");
    expect(existsSync(join(s3.root, BUCKET))).toBe(false);

    const first = await runMove(s3.url, root);

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("verified 2 copied, 0 already current");
    expect(first.stdout).toContain(`rm -rf ${root}`);

    for (const [key, contents] of OBJECTS) {
      expect(readFileSync(storedObjectPath(s3, BUCKET, key), "utf8")).toBe(contents);
      expect(readFileSync(join(root, key), "utf8")).toBe(contents);
    }

    const second = await runMove(s3.url, root);

    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("verified 0 copied, 2 already current");
  } finally {
    await s3.stop();
  }
});
