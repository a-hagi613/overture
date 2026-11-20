import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const bgJobs = sqliteTable("bg_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  runAt: integer("run_at").notNull(),
  priority: integer("priority").notNull().default(0),
  status: text("status", {
    enum: ["queued", "running", "done", "failed", "dead"],
  })
    .notNull()
    .default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(2),
  lockedUntil: integer("locked_until"),
  lastError: text("last_error"),
  dedupeKey: text("dedupe_key").unique(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const events = sqliteTable("events", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  userId: text("user_id"),
  topic: text("topic").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const killSwitches = sqliteTable(
  "kill_switches",
  {
    scope: text("scope", { enum: ["global", "ats", "employer", "provider"] }).notNull(),
    key: text("key").notNull(),
    enabled: integer("enabled").notNull().default(1),
    reason: text("reason").notNull().default(""),
    setBy: text("set_by", { enum: ["auto", "owner"] })
      .notNull()
      .default("owner"),
    setAt: integer("set_at").notNull(),
  },
  (t) => [uniqueIndex("kill_switches_scope_key").on(t.scope, t.key)],
);

export const probeForms = sqliteTable("probe_forms", {
  id: text("id").primaryKey(),
  postingUrl: text("posting_url").notNull(),
  company: text("company").notNull(),
  title: text("posting_title").notNull(),
  confirmMode: integer("confirm_mode").notNull(),
  outcome: text("outcome").notNull(),
  submitted: integer("submitted").notNull().default(0),
  confirmationSeen: integer("confirmation_seen").notNull().default(0),
  codeAsked: integer("code_asked").notNull().default(0),
  submitResponseStatus: integer("submit_response_status"),
  proxyMb: real("proxy_mb").notNull().default(0),
  browserMinutes: real("browser_minutes").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  sessionId: text("session_id"),
  createdAt: integer("created_at").notNull(),
});
