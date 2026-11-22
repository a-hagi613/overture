import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity, testAuthEnvironment } from "./auth.fixture.ts";
import { startS3Server } from "./s3-server.ts";

const createResponseSchema = z.object({ id: z.string() });

const rejectionSchema = z.object({ error: z.string() });

const fileUsageSchema = z.object({
  file: z.string(),
  mainBytes: z.number(),
  present: z.boolean(),
  shmBytes: z.number(),
  totalBytes: z.number(),
  walBytes: z.number(),
});

const postingSourceSchema = z.object({
  closed: z.number(),
  open: z.number(),
  source: z.string(),
});

const prefixUsageSchema = z.object({
  bytes: z.number(),
  objects: z.number(),
  prefix: z.string(),
});

const backupUsageSchema = z.object({
  bytes: z.number(),
  objects: z.number(),
  status: z.enum(["ok", "unavailable", "unconfigured"]),
  store: z.enum(["r2"]).nullable(),
});

const tableUsageSchema = z.object({
  bytes: z.number(),
  table: z.string(),
});

const storageReportSchema = z.object({
  databases: z.object({
    app: fileUsageSchema,
    catalog: fileUsageSchema.nullable(),
  }),
  generatedAt: z.number(),
  objects: z.object({
    backups: backupUsageSchema,
    prefixes: z.array(prefixUsageSchema),
    status: z.enum(["ok", "unavailable"]),
    store: z.enum(["disk", "r2"]),
    totalBytes: z.number(),
    totalObjects: z.number(),
  }),
  postings: z.object({
    bySource: z.array(postingSourceSchema),
    closed: z.number(),
    open: z.number(),
  }),
  tables: z
    .object({
      status: z.enum(["ok", "unavailable"]),
      tables: z.array(tableUsageSchema),
      totalBytes: z.number(),
    })
    .nullable(),
  volume: z
    .object({
      freeBytes: z.number(),
      mount: z.string(),
      totalBytes: z.number(),
      usedRatio: z.number(),
    })
    .nullable(),
});

const postingsOracleSchema = z.array(postingSourceSchema);

const PII = {
  email: "ysolde.vant@private-example.test",
  fact: "Private fact value 8f31c7d2",
  name: "Ysolde Marchetti-Vant",
  postingDescription: "A description only the privacy test could match 8f31c7d2.",
  postingTitle: "Staff Quantum Gardener 8f31c7d2",
  token: "PRIVATE-TOKEN-8f31c7d2",
} as const;

const OBJECT_FILES = [
  { bytes: 128, key: "files/owner/resume/resume.pdf.enc", prefix: "files/" },
  { bytes: 64, key: "mail/owner/html/message-1", prefix: "mail/" },
  { bytes: 32, key: "exports/owner/export-1.ovex", prefix: "exports/" },
  { bytes: 16, key: "recordings/owner/message-1.eml", prefix: "other" },
] as const;

type JsonValue = boolean | JsonValue[] | number | string | null | { [key: string]: JsonValue };

async function postJson(appUrl: string, path: string, body: JsonValue) {
  const response = await fetch(`${appUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`${path} answered ${String(response.status)}.`);
  }

  return z.unknown().parse(await response.json());
}

function postingsBySource(databasePath: string) {
  const database = new Database(databasePath, { readonly: true });

  try {
    return postingsOracleSchema.parse(
      database
        .query(
          "select ats as source, sum(case when closed_at is null then 1 else 0 end) as open, sum(case when closed_at is not null then 1 else 0 end) as closed from postings group by ats order by ats",
        )
        .all(),
    );
  } finally {
    database.close();
  }
}

async function seedPii(appUrl: string) {
  const user = createResponseSchema.parse(
    await postJson(appUrl, "/__test__/users", { email: PII.email, name: PII.name }),
  );

  await postJson(appUrl, "/__test__/facts/seed", {
    facts: [{ key: "legal_name", value: PII.fact }],
    userId: user.id,
  });

  const company = createResponseSchema.parse(
    await postJson(appUrl, "/__test__/catalog/companies", { name: "Privacy Fixture Labs" }),
  );

  const board = createResponseSchema.parse(
    await postJson(appUrl, "/__test__/catalog/boards", {
      ats: "lever",
      boardToken: "privacy-fixture",
      companyId: company.id,
    }),
  );

  return { boardId: board.id, companyId: company.id, userId: user.id };
}

async function seedPostings(appUrl: string, scope: { boardId: string; companyId: string }) {
  const openLever = [1, 2].map(async (index) =>
    postJson(appUrl, "/__test__/catalog/postings", {
      ats: "lever",
      atsJobId: `privacy-open-${String(index)}`,
      boardId: scope.boardId,
      companyId: scope.companyId,
      descriptionText: PII.postingDescription,
      title: `${PII.postingTitle} ${String(index)}`,
      url: `https://boards.example/privacy/${String(index)}?token=${PII.token}`,
    }),
  );

  const ashbyBoard = createResponseSchema.parse(
    await postJson(appUrl, "/__test__/catalog/boards", {
      ats: "ashby",
      boardToken: "privacy-ashby",
      companyId: scope.companyId,
    }),
  );

  const ashby = createResponseSchema.parse(
    await postJson(appUrl, "/__test__/catalog/postings", {
      ats: "ashby",
      atsJobId: "privacy-closed-1",
      boardId: ashbyBoard.id,
      companyId: scope.companyId,
      title: "Closed Privacy Posting",
      url: "https://boards.example/privacy/closed",
    }),
  );

  await postJson(appUrl, "/__test__/catalog/postings/close", { id: ashby.id });

  return Promise.all(openLever);
}

function seedObjects(objectsRoot: string) {
  for (const file of OBJECT_FILES) {
    const path = join(objectsRoot, file.key);

    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, Buffer.alloc(file.bytes, 1));
  }
}

function expectedPrefixes() {
  const groups = new Map<string, { bytes: number; objects: number }>([
    ["files/", { bytes: 0, objects: 0 }],
    ["mail/", { bytes: 0, objects: 0 }],
    ["exports/", { bytes: 0, objects: 0 }],
    ["other", { bytes: 0, objects: 0 }],
  ]);

  for (const file of OBJECT_FILES) {
    const group = groups.get(file.prefix);

    if (group === undefined) {
      throw new Error(`The test seeded an ungrouped prefix: ${file.key}.`);
    }

    group.bytes += file.bytes;
    group.objects += 1;
  }

  return [...groups.entries()].map(([prefix, usage]) => ({
    bytes: usage.bytes,
    objects: usage.objects,
    prefix,
  }));
}

function expectNoPii(text: string) {
  for (const value of Object.values(PII)) {
    expect(text.includes(value)).toBe(false);
  }

  expect(text.includes(authTestIdentity.ownerEmail)).toBe(false);
}

test("the admin storage report attributes bytes by database, prefix and table without personal content", async ({
  accessServer,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  page,
}) => {
  test.setTimeout(180_000);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const { databasePath, objectsRoot, url: appUrl } = adminIsolatedAppServer;

  const seeded = await seedPii(appUrl);

  await seedPostings(appUrl, seeded);
  seedObjects(objectsRoot);

  const unauthenticated = await fetch(`${adminIsolatedAppUrl}/admin/api/storage-report`);

  expect(unauthenticated.status).toBe(401);
  expect(rejectionSchema.parse(await unauthenticated.json()).error).toBe("access_required");

  const response = await page.request.get(`${adminIsolatedAppUrl}/admin/api/storage-report`);

  expect(response.status()).toBe(200);

  const raw = await response.text();

  expectNoPii(raw);
  expect(raw.includes(seeded.userId)).toBe(false);

  const report = storageReportSchema.parse(JSON.parse(raw));

  const oracle = postingsBySource(databasePath);

  expect(report.postings.bySource).toEqual(oracle);
  expect(report.postings.open).toBe(oracle.reduce((total, row) => total + row.open, 0));
  expect(report.postings.closed).toBe(oracle.reduce((total, row) => total + row.closed, 0));
  expect(report.postings.bySource.some((row) => row.source === "lever" && row.open === 2)).toBe(
    true,
  );
  expect(report.postings.bySource.some((row) => row.source === "ashby" && row.closed === 1)).toBe(
    true,
  );

  expect(report.databases.app.file).toBe("overture.db");
  expect(report.databases.app.present).toBe(true);
  expect(report.databases.app.mainBytes).toBe(statSync(databasePath).size);
  expect(
    report.databases.app.mainBytes + report.databases.app.walBytes + report.databases.app.shmBytes,
  ).toBe(report.databases.app.totalBytes);
  expect(report.databases.catalog).toBeNull();

  expect(report.volume).not.toBeNull();
  expect(report.volume?.totalBytes).toBeGreaterThan(0);
  expect(report.volume?.freeBytes).toBeGreaterThanOrEqual(0);
  expect(report.volume?.usedRatio).toBeGreaterThanOrEqual(0);
  expect(report.volume?.usedRatio).toBeLessThanOrEqual(1);

  expect(report.objects.store).toBe("disk");
  expect(report.objects.status).toBe("ok");
  expect(report.objects.prefixes).toEqual(expectedPrefixes());
  expect(report.objects.totalObjects).toBe(OBJECT_FILES.length);
  expect(report.objects.totalBytes).toBe(
    OBJECT_FILES.reduce((total, file) => total + file.bytes, 0),
  );
  expect(report.objects.backups).toEqual({
    bytes: 0,
    objects: 0,
    status: "unconfigured",
    store: null,
  });
  expect(report.tables).toBeNull();

  const catalogPath = join(databasePath, "..", "catalog.sqlite");
  const catalog = new Database(catalogPath, { create: true });

  catalog.run("create table catalog_postings (id integer primary key, ats text)");
  catalog.close();

  const withCatalog = storageReportSchema.parse(
    JSON.parse(
      await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/storage-report`)).text(),
    ),
  );

  expect(withCatalog.databases.catalog?.file).toBe("catalog.sqlite");
  expect(withCatalog.databases.catalog?.present).toBe(true);
  expect(withCatalog.databases.catalog?.mainBytes).toBe(statSync(catalogPath).size);

  const withTables = storageReportSchema.parse(
    JSON.parse(
      await (
        await page.request.get(`${adminIsolatedAppUrl}/admin/api/storage-report?dbstat=1`)
      ).text(),
    ),
  );

  expect(withTables.tables?.status).toBe("ok");
  expect(withTables.tables?.totalBytes).toBeGreaterThan(0);
  expect(withTables.tables?.tables.some((row) => row.table === "postings")).toBe(true);

  const afterSnapshot = createResponseSchema.parse(
    await postJson(appUrl, "/__test__/users", {
      email: "after@snapshot.test",
      name: "After Snapshot",
    }),
  );

  expect(afterSnapshot.id.length).toBeGreaterThan(0);

  const child = Bun.spawn({
    cmd: [
      "bun",
      "run",
      "scripts/storage-report.ts",
      "--db",
      databasePath,
      "--objects-root",
      objectsRoot,
      "--tables",
    ],
    env: { ...process.env, NODE_ENV: "test" },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expectNoPii(stdout);
  expect(stdout.includes(seeded.userId)).toBe(false);

  const cli = storageReportSchema.parse(JSON.parse(stdout));

  expect(cli.postings).toEqual(report.postings);
  expect(cli.databases.app.present).toBe(true);
  expect(cli.databases.app.mainBytes).toBeGreaterThan(0);
  expect(cli.databases.app.mainBytes).toBe(
    cli.databases.app.totalBytes - cli.databases.app.walBytes - cli.databases.app.shmBytes,
  );
  expect(cli.databases.catalog?.file).toBe("catalog.sqlite");
  expect(cli.objects.prefixes).toEqual(expectedPrefixes());
  expect(cli.objects.backups.status).toBe("unconfigured");
  expect(cli.tables?.status).toBe("ok");
  expect(cli.tables?.tables.some((row) => row.table === "postings")).toBe(true);
});

test("the CLI attributes R2 objects by prefix through the real R2 adapter", async ({
  adminIsolatedAppServer,
}) => {
  const bucket = "overture-files";
  const s3 = startS3Server();

  try {
    for (const file of OBJECT_FILES) {
      const path = join(s3.root, bucket, file.key);

      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, Buffer.alloc(file.bytes, 2));
    }

    const child = Bun.spawn({
      cmd: ["bun", "run", "scripts/storage-report.ts", "--db", adminIsolatedAppServer.databasePath],
      env: {
        ...process.env,
        ...testAuthEnvironment,
        NODE_ENV: "test",
        OBJECT_STORE_ROOT: join(s3.root, "unused"),
        R2_ACCOUNT_ID: "e2e-account",
        R2_ACCESS_KEY_ID: "e2e-access-key",
        R2_BUCKET_FILES: bucket,
        R2_ENDPOINT: s3.url,
        R2_SECRET_ACCESS_KEY: "e2e-secret-key",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const cli = storageReportSchema.parse(JSON.parse(stdout));

    expect(cli.objects.store).toBe("r2");
    expect(cli.objects.status).toBe("ok");
    expect(cli.objects.prefixes).toEqual(expectedPrefixes());
    expect(cli.objects.totalObjects).toBe(OBJECT_FILES.length);
    expect(cli.objects.backups.status).toBe("unconfigured");
  } finally {
    await s3.stop();
  }
});
