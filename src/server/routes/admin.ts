import { zValidator } from "@hono/zod-validator";
import { count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { bgJobs, grants, killSwitches, sessions, users } from "../platform/db/schema.ts";
import { DEFAULT_IMPORT_SOURCE, importTags, readTagImports } from "../catalog/tag-import.ts";
import { createAccessVerifier } from "../platform/access/index.ts";
import { env } from "../config/env.ts";
import { hasRecentPasskeyAssertion } from "../platform/passkey/index.ts";
import { listAdminAudit, recordAdminAudit } from "../platform/audit/index.ts";
import { readLlmUsage } from "../platform/llm/usage.ts";
import { applicationsLeft, grantApplications } from "../billing/ledger.ts";
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

const grantBody = z.object({
  email: z.email(),
  expiresInDays: z.number().int().min(0).max(365).nullable(),
  idempotencyKey: z.string().min(1),
  quantity: z.number().int().min(1).max(100_000),
});

const tagImportBody = z.object({
  content: z.string().min(1),
  source: z.string().min(1).default(DEFAULT_IMPORT_SOURCE),
});

const llmUsageQuery = z.object({
  purpose: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
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

  routes.post("/tag-imports", zValidator("json", tagImportBody), (context) => {
    const owner = context.get("owner");
    const { content, source } = context.req.valid("json");
    const report = importTags(db, clock, { content, source, uploadedBy: owner.userId });

    recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "tag_imports.create",
      reason: `Imported a tag file from ${source}`,
      detail: {
        id: report.id,
        source,
        rows: report.rows,
        matched: report.matched,
        unmatched: report.unmatched,
      },
    });

    return context.json(report);
  });

  routes.get("/tag-imports", (context) => context.json({ tagImports: readTagImports(db) }));

  routes.get("/grants", (context) => {
    const rows = db
      .select({ grant: grants, email: users.email })
      .from(grants)
      .innerJoin(users, eq(grants.userId, users.id))
      .orderBy(desc(grants.createdAt))
      .limit(50)
      .all();

    return context.json({
      grants: rows.map((row) => ({
        createdAt: row.grant.createdAt,
        email: row.email,
        expiresAt: row.grant.expiresAt,
        id: row.grant.id,
        quantity: row.grant.quantity,
        source: row.grant.source,
        startsAt: row.grant.startsAt,
      })),
    });
  });

  routes.post("/grants", zValidator("json", grantBody), (context) => {
    const { email, expiresInDays, idempotencyKey, quantity } = context.req.valid("json");
    const owner = context.get("owner");
    const user = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();

    if (user === undefined) {
      return context.json({ error: "user_not_found" }, 404);
    }

    const at = clock.now();
    const expiresAt = expiresInDays === null ? null : at + expiresInDays * 24 * 60 * 60 * 1000;

    const placed = grantApplications(db, clock, {
      expiresAt,
      idempotencyKey,
      quantity,
      source: "admin",
      userId: user.id,
    });

    if (placed.created) {
      recordAdminAudit(db, clock, {
        actorId: owner.userId,
        action: "grants.create",
        detail: {
          email: user.email,
          grantId: placed.grantId,
          quantity,
        },
        reason: `Granted ${String(quantity)} Applications to ${user.email} from the admin grants page`,
        targetUserId: user.id,
      });
    }

    return context.json({
      applicationsLeft: applicationsLeft(db, user.id, at),
      grantId: placed.grantId,
    });
  });

  routes.get("/llm-usage", zValidator("query", llmUsageQuery), (context) => {
    const { purpose, limit } = context.req.valid("query");

    return context.json(readLlmUsage(db, { purpose: purpose ?? null, sinceMs: null, limit }));
  });

  return routes;
}
