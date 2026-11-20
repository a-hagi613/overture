import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/platform/db/schema.ts",
  out: "./drizzle",
  strict: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "data/overture.db",
  },
});
