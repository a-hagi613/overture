import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

import { API_ERRORS } from "../../shared/api-errors.ts";

/**
 * A JSON body validator that answers in the shared error envelope. The default
 * `@hono/zod-validator` hook returns the raw `ZodError`, so a client could not
 * read `{ error }` the way it does for every other failure (SPEC §14).
 * @param schema The Zod schema the JSON body must satisfy.
 * @returns The Hono middleware that stores the parsed body as `json`.
 */
export function validJson<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result, context) =>
    result.success
      ? undefined
      : context.json({ error: API_ERRORS.invalidRequest, issues: result.error.issues }, 400),
  );
}

/**
 * A query-string validator that answers in the same shared error envelope.
 * @param schema The Zod schema the query string must satisfy.
 * @returns The Hono middleware that stores the parsed query as `query`.
 */
export function validQuery<T extends ZodType>(schema: T) {
  return zValidator("query", schema, (result, context) =>
    result.success
      ? undefined
      : context.json({ error: API_ERRORS.invalidRequest, issues: result.error.issues }, 400),
  );
}
