import { expect, test } from "bun:test";
import { z } from "zod";

import { openDatabase } from "./client.ts";
import { migrateDatabase } from "./migrate.ts";

const NOW = 1_800_000_000_000;
const ROWS = 2000;

const nameSchema = z.object({ name: z.string() });
const planSchema = z.object({ detail: z.string() });

function seeded() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  for (const user of ["user-a", "user-b"]) {
    sqlite.run(
      "insert into users (id, name, email, created_at, updated_at) values (?, ?, ?, ?, ?)",
      [user, user, `${user}@example.test`, Math.floor(NOW / 1000), Math.floor(NOW / 1000)],
    );
    sqlite.run("insert into mailboxes (id, user_id, local_part, created_at) values (?, ?, ?, ?)", [
      `mailbox-${user}`,
      user,
      user,
      Math.floor(NOW / 1000),
    ]);
  }

  const insertEvent = sqlite.prepare(
    "insert into events (user_id, topic, payload, created_at) values (?, 'inbox.changed', '{}', ?)",
  );

  const insertThread = sqlite.prepare(
    "insert into mail_threads (id, user_id, subject_enc, last_message_at) values (?, ?, 'sealed', ?)",
  );

  const insertMessage = sqlite.prepare(
    `insert into messages (id, thread_id, user_id, mailbox_id, direction, rfc_message_id, sender_domain, auth,
       from_enc, to_enc, subject_enc, text_enc, snippet_enc, created_at)
     values (?, ?, ?, ?, 'in', ?, 'example.test', 'pass', 'sealed', 'sealed', 'sealed', 'sealed', 'sealed', ?)`,
  );

  const insertApplication = sqlite.prepare(
    `insert into applications (id, user_id, posting_id, company_id, company_name, company_name_norm, posting_title,
       posting_url, origin, status, created_at, updated_at)
     values (?, ?, ?, ?, 'Northwind', 'northwind', 'Platform Engineer', 'https://example.test/job', 'auto', ?, ?, ?)`,
  );

  const insertGrant = sqlite.prepare(
    "insert into grants (id, user_id, source, quantity, starts_at, created_at) values (?, ?, 'trial', 1, ?, ?)",
  );

  for (let index = 0; index < ROWS; index += 1) {
    const user = index % 2 === 0 ? "user-a" : "user-b";
    const at = NOW - index * 1000;

    insertEvent.run(user, at);
    insertThread.run(`thread-${String(index)}`, user, Math.floor(at / 1000));
    insertMessage.run(
      `message-${String(index)}`,
      `thread-${String(index)}`,
      user,
      `mailbox-${user}`,
      `<message-${String(index)}@example.test>`,
      Math.floor(at / 1000),
    );
    insertApplication.run(
      `application-${String(index)}`,
      user,
      `posting-${String(index)}`,
      `company-${String(index)}`,
      index % 5 === 0 ? "ready" : "sent",
      Math.floor(at / 1000),
      Math.floor(at / 1000),
    );
    insertGrant.run(`grant-${String(index)}`, user, at, at);
  }

  sqlite.run("ANALYZE");

  return { db, sqlite };
}

function planOf(sqlite: ReturnType<typeof seeded>["sqlite"], query: string, ...params: string[]) {
  return sqlite
    .query(`EXPLAIN QUERY PLAN ${query}`)
    .all(...params)
    .map((row) => planSchema.parse(row).detail)
    .join("\n");
}

test("the hot-path indexes exist after every migration", () => {
  const { db, sqlite } = seeded();

  try {
    const names = z
      .array(nameSchema)
      .parse(sqlite.query("select name from sqlite_master where type = 'index'").all())
      .map((row) => row.name);

    for (const index of [
      "events_user_seq",
      "events_created_at",
      "messages_user_created",
      "applications_user_status",
      "grants_user_starts",
      "admin_audit_at",
      "admin_audit_target_user_at",
      "application_events_user_kind_at",
      "attempts_started_at",
      "bg_jobs_status_updated",
      "llm_usage_created_at",
      "session_user_id",
    ]) {
      expect(names).toContain(index);
    }
  } finally {
    db.$client.close();
  }
});

test("the SSE catch-up and retention queries use the events indexes", () => {
  const { db, sqlite } = seeded();

  try {
    const catchUp = planOf(
      sqlite,
      "select * from events where user_id = ? and seq > ? order by seq limit 50",
      "user-a",
      "100",
    );

    expect(catchUp).toContain("events_user_seq");

    const retention = planOf(
      sqlite,
      "delete from events where seq in (select seq from events where created_at < ? limit 100)",
      "100",
    );

    expect(retention).toContain("events_created_at");
  } finally {
    db.$client.close();
  }
});

test("the messages, applications and grants hot paths search their new indexes", () => {
  const { db, sqlite } = seeded();

  try {
    const messages = planOf(
      sqlite,
      "select id from messages where user_id = ? order by created_at desc limit 50",
      "user-a",
    );

    expect(messages).toContain("messages_user_created");

    const ready = planOf(
      sqlite,
      "select id from applications where user_id = ? and status = ?",
      "user-a",
      "ready",
    );

    expect(ready).toContain("applications_user_status");

    const grants = planOf(
      sqlite,
      "select id from grants where user_id = ? order by starts_at",
      "user-a",
    );

    expect(grants).toContain("grants_user_starts");
  } finally {
    db.$client.close();
  }
});

test("the retention, audit and session hot paths search their new indexes", () => {
  const { db, sqlite } = seeded();

  try {
    const audit = planOf(sqlite, "select id from admin_audit order by at desc limit 20");
    expect(audit).toContain("admin_audit_at");

    const auditTarget = planOf(
      sqlite,
      "select id from admin_audit where target_user_id = ? order by at desc limit 20",
      "user-a",
    );

    expect(auditTarget).toContain("admin_audit_target_user_at");

    const events = planOf(
      sqlite,
      "select id from application_events where user_id = ? and kind = ? order by at",
      "user-a",
      "status",
    );

    expect(events).toContain("application_events_user_kind_at");

    const usage = planOf(
      sqlite,
      "select id from llm_usage where created_at > ? order by created_at",
      "1",
    );

    expect(usage).toContain("llm_usage_created_at");

    const attempts = planOf(sqlite, "select id from attempts where started_at < ?", "1");
    expect(attempts).toContain("attempts_started_at");

    const sessions = planOf(sqlite, "select id from session where user_id = ?", "user-a");
    expect(sessions).toContain("session_user_id");

    const jobs = planOf(
      sqlite,
      "select id from bg_jobs where status = 'done' and updated_at < ?",
      "1",
    );

    expect(jobs).toContain("bg_jobs_status_updated");
  } finally {
    db.$client.close();
  }
});
