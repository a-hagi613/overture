import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const POSTING_ID = "post-0-0";

const createdSchema = z.object({ id: z.string() });
const statusSchema = z.object({ id: z.string(), status: z.string() });

const applicationRowSchema = z.object({
  companyName: z.string(),
  id: z.string(),
  status: z.string(),
});

const applicationListSchema = z.object({ applications: z.array(applicationRowSchema) });
const postingListSchema = z.object({ postings: z.array(z.unknown()) });

type RequestBody = Record<string, string>;

function catalogPathFor(databasePath: string) {
  return join(dirname(databasePath), "catalog.sqlite");
}

async function postJson<TSchema extends z.ZodType>(
  url: string,
  path: string,
  body: RequestBody,
  schema: TSchema,
) {
  const response = await fetch(`${url}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(response.ok).toBe(true);

  return schema.parse(await response.json());
}

async function createUser(url: string) {
  const created = await postJson(
    url,
    "/__test__/users",
    { email: `split-${crypto.randomUUID()}@example.test`, name: "Split User" },
    createdSchema,
  );

  return created.id;
}

async function seedApplication(
  url: string,
  userId: string,
  postingId: string,
  status: "ready" | "approved",
) {
  const created = await postJson(
    url,
    "/__test__/applications/seed",
    { postingId, status, userId },
    createdSchema,
  );

  return created.id;
}

async function holdCatalogWriteLock(catalogPath: string) {
  const child = spawn("bun", ["run", "test/e2e/catalog-lock.ts", catalogPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  await new Promise<void>((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (chunk.includes("locked")) {
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`the catalog lock process exited early (code ${String(code)})`));
    });
  });

  return {
    release: async () => {
      child.stdin.end();

      await new Promise<void>((resolve) => {
        child.once("exit", () => {
          resolve();
        });
      });
    },
  };
}

test("a catalog write lock never blocks an approval or /api/health", async ({ appServer }) => {
  const userId = await createUser(appServer.url);
  const applicationId = await seedApplication(appServer.url, userId, POSTING_ID, "ready");

  const lock = await holdCatalogWriteLock(catalogPathFor(appServer.databasePath));

  try {
    const started = performance.now();
    const health = await fetch(`${appServer.url}/api/health`);

    const approval = await postJson(
      appServer.url,
      "/__test__/applications/status",
      { applicationId, status: "approved" },
      statusSchema,
    );

    const elapsed = performance.now() - started;

    expect(health.status).toBe(200);
    expect(approval).toEqual({ id: applicationId, status: "approved" });
    expect(elapsed).toBeLessThan(3000);
  } finally {
    await lock.release();
  }

  const rows = await fetch(`${appServer.url}/__test__/applications?userId=${userId}`);

  expect(rows.ok).toBe(true);
  expect(applicationListSchema.parse(await rows.json()).applications).toMatchObject([
    { companyName: "Northwind Systems", id: applicationId, status: "approved" },
  ]);
});

test("deleting catalog.sqlite keeps users, Applications, Board, Ready and Inbox intact", async ({
  isolatedAppServer,
}) => {
  const userId = await createUser(isolatedAppServer.url);
  const applicationId = await seedApplication(isolatedAppServer.url, userId, POSTING_ID, "ready");

  const before = await fetch(`${isolatedAppServer.url}/__test__/applications?userId=${userId}`);
  const beforeRows = applicationListSchema.parse(await before.json());

  await isolatedAppServer.stop();

  const catalogPath = catalogPathFor(isolatedAppServer.databasePath);

  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${catalogPath}${suffix}`, { force: true });
  }

  await isolatedAppServer.restart();

  const health = await fetch(`${isolatedAppServer.url}/api/health`);
  const after = await fetch(`${isolatedAppServer.url}/__test__/applications?userId=${userId}`);
  const catalogRows = await fetch(`${isolatedAppServer.url}/__test__/catalog/postings`);

  expect(health.status).toBe(200);
  expect(applicationListSchema.parse(await after.json())).toEqual(beforeRows);
  expect(postingListSchema.parse(await catalogRows.json()).postings).toHaveLength(0);

  const company = await postJson(
    isolatedAppServer.url,
    "/__test__/catalog/companies",
    { domain: "rebuilt.example", name: "Rebuilt Co" },
    createdSchema,
  );

  const board = await postJson(
    isolatedAppServer.url,
    "/__test__/catalog/boards",
    { ats: "greenhouse", boardToken: "rebuilt", companyId: company.id, source: "import" },
    createdSchema,
  );

  const posting = await postJson(
    isolatedAppServer.url,
    "/__test__/catalog/postings",
    {
      ats: "greenhouse",
      atsJobId: "rebuilt-1",
      boardId: board.id,
      companyId: company.id,
      title: "Rebuilt Role",
      url: "https://rebuilt.example/jobs/1",
    },
    createdSchema,
  );

  const reseeded = await seedApplication(isolatedAppServer.url, userId, posting.id, "approved");

  expect(reseeded).not.toBe(applicationId);

  const rows = await fetch(`${isolatedAppServer.url}/__test__/applications?userId=${userId}`);

  expect(applicationListSchema.parse(await rows.json()).applications).toHaveLength(2);
});
