import type { Context, Hono, Next } from "hono";

import { ADMIN_REFUSAL_CODES } from "./routes/admin-refusals.ts";

export function hostnameFromHeader(hostHeader: string | undefined) {
  if (hostHeader === undefined || hostHeader === "") {
    return "";
  }

  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return "";
  }
}

export function isAdminHost(hostname: string, adminOrigin: string) {
  try {
    return hostname === new URL(adminOrigin).hostname;
  } catch {
    return false;
  }
}

export function dispatchByHost(adminHost: Hono, adminOrigin: string) {
  return async (context: Context, next: Next) => {
    const hostname = hostnameFromHeader(context.req.header("host"));

    if (isAdminHost(hostname, adminOrigin)) {
      return adminHost.fetch(context.req.raw);
    }

    return next();
  };
}

export function mainHostAdminApiRefusal(context: Context) {
  return context.json({ error: ADMIN_REFUSAL_CODES.accessRequired }, 401);
}
