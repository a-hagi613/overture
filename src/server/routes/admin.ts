import { zValidator } from "@hono/zod-validator";
import { count, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { bgJobs, killSwitches, sessions, users } from "../platform/db/schema.ts";
import { createAccessVerifier } from "../platform/access/index.ts";
import { env } from "../config/env.ts";
import { hasRecentPasskeyAssertion } from "../platform/passkey/index.ts";
import { listAdminAudit, recordAdminAudit } from "../platform/audit/index.ts";
import {
  getAllKillSwitches,
  getAllSettings,
  getSetting,
  setKillSwitch,
  setSetting,
} from "../platform/settings/index.ts";

const settingBody = z.object({ value: z.string().min(1) });

const killSwitchBody = z.object({
  enabled: z.boolean(),
  reason: z.string().default(""),
});

const ATS_NAMES = ["greenhouse", "lever", "ashby"] as const;

export const ADMIN_REFUSAL_CODES = {
  accessRequired: "access_required",
  signInRequired: "sign_in_required",
  ownerRequired: "owner_required",
  passkeyRequired: "passkey_required",
} as const;

interface OwnerContext {
  userId: string;
  email: string;
}

interface AdminEnv {
  Variables: { owner: OwnerContext };
}

export function isAdminHost(hostname: string, adminOrigin: string) {
  try {
    return hostname === new URL(adminOrigin).hostname;
  } catch {
    return false;
  }
}

export function createAdminApi(db: AppDatabase, clock: Clock, auth: Auth) {
  const verifier = createAccessVerifier({
    jwksUrl: env.CF_ACCESS_JWKS_URL,
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    audience: env.CF_ACCESS_AUD,
  });

  const routes = new Hono<AdminEnv>();

  routes.use("*", async (context, next) => {
    if (verifier !== null) {
      const identity = await verifier.verify(context.req.raw);

      if (identity === null) {
        return context.json({ error: ADMIN_REFUSAL_CODES.accessRequired }, 401);
      }

      const session = await auth.api.getSession({ headers: context.req.raw.headers });

      if (session === null) {
        return context.json({ error: ADMIN_REFUSAL_CODES.signInRequired }, 401);
      }

      if (session.user.role !== "owner") {
        return context.json({ error: ADMIN_REFUSAL_CODES.ownerRequired }, 403);
      }

      if (!hasRecentPasskeyAssertion(db, clock, session.user.id)) {
        return context.json({ error: ADMIN_REFUSAL_CODES.passkeyRequired }, 403);
      }

      context.set("owner", { userId: session.user.id, email: session.user.email });

      await next();

      return context.res;
    }

    return context.json({ error: ADMIN_REFUSAL_CODES.accessRequired }, 401);
  });

  routes.get("/overview", (context) => {
    const jobCounts = db
      .select({ status: bgJobs.status, total: count() })
      .from(bgJobs)
      .groupBy(bgJobs.status)
      .all();

    const userTotals = db.select({ total: count() }).from(users).all();

    const ownerTotals = db
      .select({ total: count() })
      .from(users)
      .where(sql`${users.role} = 'owner'`)
      .all();

    const sessionTotals = db.select({ total: count() }).from(sessions).all();

    const allSwitches = getAllKillSwitches(db);
    const audit = listAdminAudit(db, 20);

    const jobs: Record<string, number> = {};

    for (const row of jobCounts) {
      jobs[row.status] = row.total;
    }

    return context.json({
      now: clock.now(),
      jobs,
      users: { total: userTotals[0]?.total ?? 0, owners: ownerTotals[0]?.total ?? 0 },
      sessions: sessionTotals[0]?.total ?? 0,
      killSwitches: {
        total: allSwitches.length,
        enabled: allSwitches.filter((row) => row.enabled === 1).length,
      },
      audit: audit.map((row) => ({
        id: row.id,
        at: row.at.getTime(),
        actorId: row.actorId,
        action: row.action,
        targetUserId: row.targetUserId,
        reason: row.reason,
        detail: row.detail,
      })),
    });
  });

  routes.get("/settings", (context) => context.json({ settings: getAllSettings(db) }));

  routes.put("/settings/:key", zValidator("json", settingBody), (context) => {
    const { key } = context.req.param();
    const { value } = context.req.valid("json");

    const owner = context.get("owner");

    const before = getSetting(db, key);

    setSetting(db, clock, key, value, owner.userId);

    recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "settings.update",
      reason: "Changed from the admin settings page",
      detail: { key, before: before ?? null, after: value },
    });

    return context.json({ key, value });
  });

  routes.get("/kill-switches", (context) => context.json({ switches: getAllKillSwitches(db) }));

  routes.put("/kill-switches/:scope/:key", zValidator("json", killSwitchBody), (context) => {
    const { scope, key } = context.req.param();
    const { enabled, reason } = context.req.valid("json");
    const owner = context.get("owner");
    const scopeCheck = z.enum(["global", "ats", "employer", "provider"]).safeParse(scope);

    if (!scopeCheck.success) {
      return context.json({ error: "invalid scope" }, 400);
    }

    const before = getAllKillSwitches(db).find(
      (row) => row.scope === scopeCheck.data && row.key === key,
    );

    setKillSwitch(db, clock, scopeCheck.data, key, enabled, reason, "owner");

    recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "kill_switch.update",
      reason: reason.length > 0 ? reason : "Changed from the admin kill switches page",
      detail: {
        scope: scopeCheck.data,
        key,
        before: before === undefined ? null : before.enabled === 1,
        after: enabled,
      },
    });

    return context.json({ scope: scopeCheck.data, key, enabled, reason });
  });

  routes.get("/catalog", (context) => {
    const ats = ATS_NAMES.map((name) => {
      const hourlyLimitSetting = getSetting(db, `limits.ats_hourly.${name}`);

      const hourlyLimit = hourlyLimitSetting === null ? null : Number(hourlyLimitSetting);

      const enabledSwitch = db
        .select()
        .from(killSwitches)
        .where(sql`${killSwitches.scope} = 'ats' AND ${killSwitches.key} = ${name}`)
        .get();

      return {
        ats: name,
        hourlyLimit,
        killSwitchEnabled: enabledSwitch === undefined ? null : enabledSwitch.enabled === 1,
      };
    });

    return context.json({ discoveredAt: null, ats });
  });

  routes.get("/audit", (context) => {
    const audit = listAdminAudit(db, 100);

    return context.json({
      audit: audit.map((row) => ({
        id: row.id,
        at: row.at.getTime(),
        actorId: row.actorId,
        action: row.action,
        targetUserId: row.targetUserId,
        reason: row.reason,
        detail: row.detail,
      })),
    });
  });

  return routes;
}
