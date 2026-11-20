import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
