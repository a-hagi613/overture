import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./client.ts";
import { migrateDatabase } from "./migrate.ts";
import {
  createOutboundCallRefusal,
  jobsUnchanged,
  OutboundCallRefusedError,
  readJobSnapshot,
  verifyRestoredDatabase,
} from "./restore-check.ts";

const NOW = 1_800_000_000_000;
const SECOND = 1000;

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function scratchDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "restore-check-"));
  scratchDirectories.push(directory);

  return join(directory, "restored.db");
}

function seededRestoredDatabase() {
  const path = scratchDatabasePath();
  const { db, sqlite } = openDatabase(path);

  migrateDatabase(db, "drizzle");

  const stamp = Math.trunc(NOW / SECOND);

  sqlite.run("insert into users (id, name, email, created_at, updated_at) values (?, ?, ?, ?, ?)", [
    "user-1",
    "Owner",
    "owner@example.com",
    stamp,
    stamp,
  ]);
  sqlite.run("insert into companies (id, name, name_norm, created_at) values (?, ?, ?, ?)", [
    "company-1",
    "Example",
    "example",
    NOW,
  ]);
  sqlite.run(
    "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
    ["board-1", "company-1", "greenhouse", "example", "us", "active", "v1_seed", NOW],
  );
  sqlite.run(
    "insert into postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm, first_seen_at, last_seen_at, dedupe_key) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      "posting-1",
      "board-1",
      "company-1",
      "greenhouse",
      "job-1",
      "https://boards.greenhouse.io/example/jobs/1",
      "https://boards.greenhouse.io/example/jobs/1",
      "Engineer",
      "engineer",
      NOW,
      NOW,
      "example:engineer",
    ],
  );
  sqlite.run(
    "insert into applications (id, user_id, posting_id, company_id, company_name, company_name_norm, posting_title, posting_url, origin, status, approved_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      "application-1",
      "user-1",
      "posting-1",
      "company-1",
      "Example",
      "example",
      "Engineer",
      "https://boards.greenhouse.io/example/jobs/1",
      "manual",
      "approved",
      NOW,
      NOW,
      NOW,
    ],
  );
  sqlite.run(
    "insert into mailboxes (id, user_id, local_part, status, created_at) values (?, ?, ?, ?, ?)",
    ["mailbox-1", "user-1", "owner", "active", stamp],
  );
  sqlite.run(
    "insert into mail_threads (id, user_id, subject_enc, last_message_at) values (?, ?, ?, ?)",
    ["thread-1", "user-1", "encrypted", stamp],
  );
  sqlite.run(
    "insert into messages (id, thread_id, user_id, mailbox_id, direction, rfc_message_id, sender_domain, auth, from_enc, to_enc, subject_enc, text_enc, snippet_enc, out_status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      "message-1",
      "thread-1",
      "user-1",
      "mailbox-1",
      "out",
      "<queued@example.com>",
      "example.com",
      "pass",
      "encrypted",
      "encrypted",
      "encrypted",
      "encrypted",
      "encrypted",
      "queued",
      stamp,
    ],
  );

  const dueJob = sqlite.prepare(
    "insert into bg_jobs (id, kind, payload, run_at, status, attempts, max_attempts, created_at, updated_at) values (?, ?, ?, ?, 'queued', 0, 2, ?, ?)",
  );

  dueJob.run(
    "job-send",
    "application.send",
    '{"applicationId":"application-1"}',
    NOW - SECOND,
    NOW,
    NOW,
  );
  dueJob.run("job-ready", "ready.notify", '{"userId":"user-1"}', NOW - SECOND, NOW, NOW);
  dueJob.run("job-mail", "mail.classify", '{"messageId":"message-1"}', NOW - SECOND, NOW, NOW);
  dueJob.run("job-billing-notice", "billing.notice", '{"userId":"user-1"}', NOW - SECOND, NOW, NOW);
  dueJob.run("job-billing-reconcile", "billing.reconcile", "{}", NOW - SECOND, NOW, NOW);
  sqlite.run(
    "insert into bg_jobs (id, kind, payload, run_at, status, attempts, max_attempts, locked_until, created_at, updated_at) values (?, ?, ?, ?, 'running', 1, 2, ?, ?, ?)",
    [
      "job-send-inflight",
      "application.send",
      '{"applicationId":"application-1"}',
      NOW - SECOND,
      NOW + SECOND,
      NOW,
      NOW,
    ],
  );

  sqlite.close();

  return path;
}

function jobStates(path: string) {
  const sqlite = new Database(path, { readonly: true });

  try {
    return sqlite.query("select id, status, attempts, locked_until from bg_jobs order by id").all();
  } finally {
    sqlite.close();
  }
}

function fileDigest(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("the restored-database check", () => {
  test("passes a restored database full of due work without claiming a job or reaching the network", () => {
    const path = seededRestoredDatabase();
    const before = jobStates(path);
    const digestBefore = fileDigest(path);

    const report = verifyRestoredDatabase(path, { now: NOW });

    expect(report.ok).toBe(true);
    expect(report.readOnly).toBe(true);
    expect(report.integrity).toBe("ok");
    expect(report.migrations).toBeGreaterThan(0);
    expect(report.rowCount.users).toBe(1);
    expect(report.rowCount.applications).toBe(1);
    expect(report.rowCount.messages).toBe(1);
    expect(report.rowCount.bg_jobs).toBe(6);
    expect(report.jobs.total).toBe(6);
    expect(report.jobs.due).toBe(5);
    expect(report.jobs.unchanged).toBe(true);
    expect(report.outboundCalls).toEqual([]);
    expect(report.failures).toEqual([]);
    expect(jobStates(path)).toEqual(before);
    expect(fileDigest(path)).toBe(digestBefore);
  });

  test("fails when a restored table holds fewer rows than the source did", () => {
    const path = seededRestoredDatabase();

    const report = verifyRestoredDatabase(path, {
      now: NOW,
      expectedRowCounts: { users: 1, applications: 2, messages: 1 },
    });

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("table applications has 1 restored rows, expected 2");
  });

  test("fails when the restored database has no applied migrations", () => {
    const path = scratchDatabasePath();
    const sqlite = new Database(path);

    sqlite.run("create table placeholder (id text primary key)");
    sqlite.close();

    const report = verifyRestoredDatabase(path, { now: NOW });

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("restored database has no applied migrations");
  });

  test("fails when the restored database holds fewer migrations than this build applies", () => {
    const path = seededRestoredDatabase();

    const report = verifyRestoredDatabase(path, { now: NOW, expectedMigrations: 1000 });

    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes("expected 1000"))).toBe(true);
  });

  test("tells an untouched job snapshot apart from a claimed one", () => {
    const path = seededRestoredDatabase();
    const before = readJobSnapshot(path);
    const sqlite = new Database(path);

    sqlite.run(
      "update bg_jobs set status = 'running', attempts = attempts + 1 where id = 'job-send'",
    );
    sqlite.close();

    expect(jobsUnchanged(before, readJobSnapshot(path))).toBe(false);
    expect(jobsUnchanged(before, before)).toBe(true);
  });
});

test("the drill outbound guard refuses every request and names it", () => {
  const created = createOutboundCallRefusal(globalThis.fetch);
  const endpoint = "https://api.cloudflare.com/client/v4/accounts/x/email";

  let failure: Error | null = null;

  try {
    created.fetch(endpoint);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  expect(failure).toBeInstanceOf(OutboundCallRefusedError);
  expect(created.calls).toEqual([endpoint]);
});
