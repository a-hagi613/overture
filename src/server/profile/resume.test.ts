import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { and, eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { resumes, users } from "../platform/db/schema.ts";
import {
  createAnthropicBatchProvider,
  createAnthropicLlmPort,
} from "../platform/llm/anthropic-batches.ts";
import { createDurableBatches } from "../platform/llm/durable-batches.ts";
import { DEFAULT_ANTHROPIC_MODEL } from "../platform/llm/models.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createDiskObjectStore } from "../platform/ports/object-store.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";

const MASTER = new Uint8Array(32).fill(7);

Bun.env.BETTER_AUTH_SECRET ??= "resume-test-secret-value";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(MASTER).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { createResumeService } = await import("./resume.ts");

const USER_ID = "resume-rollback-user";
const NOW = 1_800_000_000_000;

const countSchema = z.object({ total: z.number() });

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fresh() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "resume@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Resume",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();

  db.insert(resumes)
    .values({
      bytes: 3,
      filenameEnc: "sealed",
      id: "resume-current",
      isCurrent: true,
      objectKey: "files/old.pdf",
      pages: 1,
      parsedWith: "unpdf",
      sha256: "old",
      textEnc: "sealed",
      uploadedAt: new Date(NOW - 1000),
      userId: USER_ID,
    })
    .run();

  const clock = createClock();

  return { clock, db, sqlite };
}

describe("the resume replacement transaction", () => {
  test("keeps the previous resume current when the insert fails", async () => {
    const { clock, db, sqlite } = fresh();
    const directory = mkdtempSync(join(tmpdir(), "resume-upload-"));

    scratchDirectories.push(directory);

    const objects = createDiskObjectStore(directory);
    const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));

    const config = {
      apiKey: undefined,
      baseUrl: "http://127.0.0.1:9",
      model: DEFAULT_ANTHROPIC_MODEL,
    };

    const llm = createAnthropicLlmPort(
      config,
      createDurableBatches({
        clock,
        db,
        maxWaitMs: 1000,
        model: config.model,
        pollIntervalMs: 1000,
        provider: createAnthropicBatchProvider(config),
      }),
    );

    const service = createResumeService({ clock, db, llm, objects, personal });
    const pdf = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

    sqlite.run(
      "create trigger reject_resume before insert on resumes begin select raise(abort, 'forced resume failure'); end",
    );

    let failed = false;

    try {
      await service.upload(USER_ID, { bytes: pdf, name: "resume.pdf" });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);

    expect(
      countSchema.parse(
        sqlite
          .query("select count(*) as total from resumes where user_id = ? and is_current = 1")
          .get(USER_ID),
      ).total,
    ).toBe(1);
    expect(
      db
        .select({ id: resumes.id })
        .from(resumes)
        .where(and(eq(resumes.userId, USER_ID), eq(resumes.isCurrent, true)))
        .all(),
    ).toEqual([{ id: "resume-current" }]);

    sqlite.close();
  });
});
