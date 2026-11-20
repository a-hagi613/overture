import { z } from "zod";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1).default("data/overture.db"),
  STATIC_ROOT: z.string().min(1).default("dist"),
  ENABLE_TEST_ROUTES: booleanFromString.default(false),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
