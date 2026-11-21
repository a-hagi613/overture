import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DatabaseSync } from "node:sqlite";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { serverEnvironment } from "./app-server.ts";
import { startS3Server, storedObjectPath } from "./s3-server.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";
import { authTestIdentity } from "./auth.fixture.ts";

const uploadSchema = z.object({
  id: z.string(),
  sha256: z.string().length(64),
  bytes: z.number(),
});

const resumeRowSchema = z.object({
  object_key: z.string(),
  user_id: z.string(),
});

const BUCKET = "overture-files";

const r2Environment = (endpoint: string, root: string) => ({
  R2_ACCOUNT_ID: "e2e-account",
  R2_ACCESS_KEY_ID: "e2e-access-key",
  R2_SECRET_ACCESS_KEY: "e2e-secret-key",
  R2_BUCKET_FILES: BUCKET,
  R2_ENDPOINT: endpoint,
  OBJECT_STORE_ROOT: root,
});

async function ownerContextFor(appServerUrl: string) {
  const owner = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  await owner.get(link);

  const state = await verifyAuthState(appServerUrl, owner);

  expect(state.users.at(-1)?.role).toBe("owner");

  return owner;
}

test("a resume lives in the R2 files bucket as ciphertext and reads back byte for byte", async ({
  identityServer,
}) => {
  const s3 = startS3Server();
  const diskRoot = join(mkdtempSync(join(tmpdir(), "overture-disk-")), "objects");
  const server = await startFreshAppServer(identityServer, r2Environment(s3.url, diskRoot));

  try {
    const owner = await ownerContextFor(server.url);
    const pdfBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

    const upload = await owner.post("/api/profile/resume", {
      multipart: {
        file: { name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfBytes) },
      },
    });

    const created = uploadSchema.parse(await upload.json());

    expect(created.bytes).toBe(pdfBytes.byteLength);

    const download = await owner.get(`/api/profile/resume/${created.id}/file`);
    const returned = new Uint8Array(await download.body());

    expect(Buffer.from(returned).equals(pdfBytes)).toBe(true);

    const sqlite = new DatabaseSync(server.databasePath, { readOnly: true });
    sqlite.exec("PRAGMA busy_timeout = 5000;");

    const row = resumeRowSchema.parse(
      sqlite.prepare("select object_key, user_id from resumes limit 1").get(),
    );

    sqlite.close();

    expect(row.object_key).toBe(`files/${row.user_id}/resume/${created.id}.pdf.enc`);
    expect(existsSync(diskRoot)).toBe(false);

    const stored = readFileSync(storedObjectPath(s3, BUCKET, row.object_key));
    const sealed = new TextDecoder().decode(new Uint8Array(stored));

    expect(Buffer.from(stored).equals(Buffer.from(pdfBytes))).toBe(false);
    expect(sealed).not.toContain("%PDF");
    expect(sealed.startsWith("v1:1:")).toBe(true);
    expect(sealed.split(":")).toHaveLength(5);
  } finally {
    await server.stop();
    await s3.stop();
  }
});

test("a half-set R2 files config stops the server at boot", () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-boot-"));

  const result = Bun.spawnSync({
    cmd: ["bun", "run", "src/server/main.ts"],
    env: serverEnvironment({
      R2_BUCKET_FILES: BUCKET,
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      DATABASE_URL: join(directory, "overture.db"),
      ENABLE_TEST_ROUTES: "false",
    }),
  });

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("R2_BUCKET_FILES");
});
