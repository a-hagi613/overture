import { expect, test } from "bun:test";
import { z } from "zod";

import { openCatalogDatabase, openDatabase } from "./client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "./migrate.ts";

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
     values (?, ?, ?, ?, 'Northwind', 'northwind', 'Platform Engineer', 'https://example.test/job', 'pick', ?, ?, ?)`,
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

test("the retention, audit, session and freehire job hot paths search their new indexes", () => {
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

    const supply = planOf(
      sqlite,
      `select source, count(*) from jobs
         where status = 'open'
           and not (instr(lower(title_norm), 'talent pool') > 0)
         group by source`,
    );

    expect(supply).toContain("jobs_status_posted");
    expect(supply).not.toMatch(/SCAN jobs\b/u);

    const supplyByCategory = planOf(
      sqlite,
      "select source, count(*) from jobs where status = 'open' and category = ? group by source",
      "backend",
    );

    expect(supplyByCategory).toContain("jobs_category_status");
  } finally {
    db.$client.close();
  }
});

test("the catalog candidate and requisition hot paths search their new indexes", () => {
  const { db, sqlite } = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(db, "drizzle-catalog");

  sqlite.run(
    "insert into companies (id, name, name_norm, created_at) values ('company-a', 'A', 'a', ?)",
    [NOW],
  );
  sqlite.run(
    "insert into companies (id, name, name_norm, created_at) values ('company-b', 'B', 'b', ?)",
    [NOW],
  );
  sqlite.run(
    "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values ('board-a', 'company-a', 'greenhouse', 'a', 'us', 'active', 'v1_seed', ?)",
    [NOW],
  );
  sqlite.run(
    "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values ('board-b', 'company-b', 'smartrecruiters', 'b', 'us', 'active', 'v1_seed', ?)",
    [NOW],
  );

  const insertPosting = sqlite.prepare(
    `insert into postings (id, board_id, company_id, ats, ats_job_id, requisition_id, url, apply_url_norm,
       title, title_norm, location_raw, country_code, city, language, workplace, employment_type,
       first_seen_at, last_seen_at, dedupe_key, apply_supported, status)
     values (?, ?, ?, ?, ?, ?, ?, ?, 'Engineer', 'engineer', 'Remote', 'US', 'Austin', 'en', 'remote',
       'full_time', ?, ?, ?, ?, ?)`,
  );

  const insertTag = sqlite.prepare(
    "insert into posting_tags (posting_id, dimension, value, source) values (?, ?, ?, 'rules')",
  );

  try {
    for (let index = 0; index < ROWS; index += 1) {
      const supportable = index % 5 !== 0;
      const ats = supportable ? "greenhouse" : "smartrecruiters";
      const boardId = supportable ? "board-a" : "board-b";
      const companyId = supportable ? "company-a" : "company-b";
      const url = `https://example.test/${String(index)}`;

      insertPosting.run(
        `posting-${String(index)}`,
        boardId,
        companyId,
        ats,
        String(index),
        supportable ? `req-${String(index)}` : null,
        url,
        url,
        NOW,
        NOW,
        `key-${String(index)}`,
        supportable ? 1 : 0,
        index % 7 === 0 ? "closed" : "open",
      );
      insertTag.run(`posting-${String(index)}`, "role", "Engineer");
      insertTag.run(`posting-${String(index)}`, "seniority", "senior");
    }

    sqlite.run("ANALYZE");

    const names = z
      .array(nameSchema)
      .parse(sqlite.query("select name from sqlite_master where type = 'index'").all())
      .map((row) => row.name);

    expect(names).toContain("postings_apply_supported_status");
    expect(names).toContain("postings_company_requisition");
    expect(names).toContain("posting_tags_dimension_value_posting");
    expect(names).not.toContain("posting_tags_dimension_value");
    expect(names).toContain("postings_supply_ats");
    expect(names).toContain("postings_supply_country");
    expect(names).toContain("postings_live_city");
    expect(names).toContain("postings_live_region");

    const candidate = sqlite
      .query(
        `EXPLAIN QUERY PLAN select p.id from postings p
           inner join companies c on c.id = p.company_id
         where p.closed_at is null and p.status = 'open' and p.apply_supported = 1
           and p.workplace in ('remote') and p.employment_type in ('full_time')
           and lower(p.language) in ('en')
           and exists (select 1 from posting_tags t where t.posting_id = p.id
             and t.dimension in ('role', 'subrole') and t.value in ('Engineer'))
           and exists (select 1 from posting_tags t2 where t2.posting_id = p.id
             and t2.dimension = 'seniority' and t2.value in ('senior'))`,
      )
      .all()
      .map((row) => planSchema.parse(row).detail)
      .join("\n");

    expect(candidate).toContain("postings_supply_ats");
    expect(candidate).not.toMatch(/SCAN p\b/u);

    const requisition = sqlite
      .query(
        "EXPLAIN QUERY PLAN select id from postings where company_id = ? and requisition_id = ?",
      )
      .all("company-a", "req-3")
      .map((row) => planSchema.parse(row).detail)
      .join("\n");

    expect(requisition).toContain("postings_company_requisition");

    const supply = planOf(
      sqlite,
      `select ats, count(*) from postings
         where closed_at is null and status = 'open' and apply_supported = 1
           and exists (select 1 from posting_tags t where t.posting_id = postings.id
             and t.dimension in ('role', 'subrole') and t.value = ?)
           and country_code = ? and workplace = 'remote'
         group by ats`,
      "Engineer",
      "US",
    );

    expect(supply).toContain("postings_supply_country");
    expect(supply).toContain("posting_tags_dimension_value_posting");
    expect(supply).not.toMatch(/SCAN postings\b/u);

    const unfiltered = planOf(
      sqlite,
      `select ats, count(*) from postings
         where closed_at is null and status = 'open' and apply_supported = 1
         group by ats`,
    );

    expect(unfiltered).toContain("postings_supply_ats");
    expect(unfiltered).not.toMatch(/TEMP B-TREE/u);

    const city = planOf(
      sqlite,
      `select ats, count(*) from postings indexed by postings_live_city
         where closed_at is null and status = 'open' and apply_supported = 1
           and country_code = ? and lower(city) = ?
         group by ats`,
      "US",
      "nowhere",
    );

    expect(city).toContain("postings_live_city");
    expect(city).not.toMatch(/SCAN postings\b/u);

    const region = planOf(
      sqlite,
      `select ats, count(*) from postings indexed by postings_live_region
         where closed_at is null and status = 'open' and apply_supported = 1
           and country_code = ? and (lower(region) = ? or lower(region) = ?)
         group by ats`,
      "US",
      "texas",
      "tx",
    );

    expect(region).toContain("postings_live_region");
    expect(region).not.toMatch(/SCAN postings\b/u);
  } finally {
    db.$client.close();
  }
});
