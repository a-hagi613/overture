import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  dueAt: integer("due_at").notNull(),
  claimedAt: integer("claimed_at"),
  finishedAt: integer("finished_at"),
});
