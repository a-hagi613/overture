import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";
import type { ExportService } from "../export/service.ts";

import { EXPORT_VALID_MS } from "../export/service.ts";

export interface AccountRoutesDeps {
  auth: Auth;
  exports: ExportService;
}

/**
 * The account export endpoints: ask for an export, read its state, and stream
 * its encrypted archive. The archive is decrypted by the page with the key in
 * the download link, never by the server.
 * @param deps The session auth and the export service.
 * @returns The routes for the account export.
 */
export function createAccountRoutes(deps: AccountRoutesDeps) {
  const { auth, exports } = deps;
  const routes = new Hono();

  async function sessionUser(raw: Request) {
    const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

    return result?.user ?? null;
  }

  routes.get("/account/export", async (context) => {
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json(await exports.state(user.id));
  });

  routes.post("/account/export", async (context) => {
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const result = await exports.request(user.id);

    return context.json({ ...result.state, replaced: result.replaced }, 202);
  });

  routes.get("/account/export/:id/download", async (context) => {
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const result = await exports.download(user.id, context.req.param("id"));

    if (result === "not_found") {
      return context.json({ error: "not_found" }, 404);
    }

    if (result === "expired") {
      return context.json({ error: "export_expired" }, 410);
    }

    const headers = new Headers({
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="overture-export.ovex"',
      "content-type": "application/octet-stream",
      "x-export-valid-for-seconds": String(Math.floor(EXPORT_VALID_MS / 1000)),
    });

    if (result.bytes > 0) {
      headers.set("content-length", String(result.bytes));
    }

    return new Response(result.stream, { headers });
  });

  return routes;
}
