import { defineConfig } from "drizzle-kit";

/**
 * The catalog database has its own migrations (ADR 0036). `drizzle/` belongs to `app.sqlite`, `drizzle-catalog/` to
 * `catalog.sqlite`; neither folder ever sees the other's tables.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/platform/db/catalog-schema.ts",
  out: "./drizzle-catalog",
  strict: true,
  dbCredentials: {
    url: process.env.CATALOG_DATABASE_PATH ?? "data/catalog.sqlite",
  },
});
