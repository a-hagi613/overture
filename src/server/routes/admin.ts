import { zValidator } from "@hono/zod-validator";
import { count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { InviteRow } from "../auth/invites.ts";

import {
  applications,
  attempts,
  bgJobs,
  grants,
  invites,
  killSwitches,
  postings,
  sessions,
  users,
} from "../platform/db/schema.ts";
import { DEFAULT_IMPORT_SOURCE, importTags, readTagImports } from "../catalog/tag-import.ts";
import { createAccessVerifier } from "../platform/access/index.ts";
import { env } from "../config/env.ts";
import { hasRecentPasskeyAssertion } from "../platform/passkey/index.ts";
import { listAdminAudit, recordAdminAudit } from "../platform/audit/index.ts";
import { readLlmUsage } from "../platform/llm/usage.ts";
import { applicationsLeft, grantApplications } from "../billing/ledger.ts";
import { buildCostSummary, buildProviderReport } from "../dispatch/report.ts";
import { FIXTURE_CAPTURE_JOB_KIND, fixtureCapturePayloadSchema } from "../fixtures/job.ts";
import { enqueueLiveCheckNow } from "../live-checks/job.ts";
import { readLiveCheckResults } from "../live-checks/store.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import {
  getAllKillSwitches,
  getAllSettings,
  getSetting,
  setKillSwitch,
  setSetting,
} from "../platform/settings/index.ts";
import { inviteEmailHash, inviteStatus } from "../auth/invites.ts";
import { isSameMailbox } from "../auth/email.ts";

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

const inviteBody = z.object({ email: z.email() });

const llmUsageQuery = z.object({
  purpose: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const attemptsQuery = z.object({
  applicationId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const captureBody = fixtureCapturePayloadSchema;

export interface AdminDeps {
  providers: BrowserProviderRegistry | null;
  personal: PersonalCrypto;
}

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

export function createAdminApi(db: AppDatabase, clock: Clock, auth: Auth, deps: AdminDeps) {
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

  const inviteSecret = env.BETTER_AUTH_SECRET;

  async function invitationView(invite: InviteRow, ownerId: string) {
    const sealedBy = invite.invitedBy ?? ownerId;

    const email =
      invite.emailEnc === null
        ? null
        : await deps.personal
            .openFor(
              sealedBy,
              { table: "invites", column: "email_enc", rowId: invite.id },
              invite.emailEnc,
            )
            .catch(() => null);

    return {
      acceptedAt: invite.acceptedAt === null ? null : invite.acceptedAt.getTime(),
      acceptedUserId: invite.acceptedUserId,
      createdAt: invite.createdAt.getTime(),
      email,
      grantId: invite.grantId,
      id: invite.id,
      invitedBy: invite.invitedBy,
      revokedAt: invite.revokedAt === null ? null : invite.revokedAt.getTime(),
      status: inviteStatus(invite),
    };
  }

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
      cost: buildCostSummary(db),
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

  routes.get("/invites", async (context) => {
    const owner = context.get("owner");
    const rows = db.select().from(invites).orderBy(desc(invites.createdAt)).all();

    const views = await Promise.all(rows.map(async (row) => invitationView(row, owner.userId)));

    return context.json({ invites: views });
  });

  routes.post("/invites", zValidator("json", inviteBody), async (context) => {
    const owner = context.get("owner");
    const email = context.req.valid("json").email.trim();

    const currentUser = db
      .select({ email: users.email })
      .from(users)
      .all()
      .find((row) => isSameMailbox(row.email, email));

    if (currentUser !== undefined) {
      return context.json({ error: "user_exists" }, 409);
    }

    const emailHash = inviteEmailHash(inviteSecret, email);
    const existing = db.select().from(invites).where(eq(invites.emailHash, emailHash)).get();

    if (existing !== undefined) {
      if (existing.acceptedAt !== null) {
        return context.json({ error: "already_accepted" }, 409);
      }

      if (existing.revokedAt === null) {
        return context.json({ error: "already_invited" }, 409);
      }
    }

    const id = existing?.id ?? crypto.randomUUID();

    const emailEnc = await deps.personal.sealFor(
      owner.userId,
      { table: "invites", column: "email_enc", rowId: id },
      email,
    );

    const createdAt = new Date(clock.now());

    if (existing === undefined) {
      db.insert(invites)
        .values({
          id,
          emailHash,
          emailEnc,
          invitedBy: owner.userId,
          acceptedAt: null,
          acceptedUserId: null,
          revokedAt: null,
          grantId: null,
          createdAt,
        })
        .run();
    } else {
      db.update(invites)
        .set({
          emailEnc,
          invitedBy: owner.userId,
          acceptedAt: null,
          acceptedUserId: null,
          revokedAt: null,
          grantId: null,
          createdAt,
        })
        .where(eq(invites.id, id))
        .run();
    }

    recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "invites.create",
      reason: `Invited ${email} to the beta`,
      detail: { email, inviteId: id },
    });

    const row = db.select().from(invites).where(eq(invites.id, id)).get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    return context.json({ invite: await invitationView(row, owner.userId) }, 201);
  });

  routes.post("/invites/:id/revoke", async (context) => {
    const owner = context.get("owner");

    const row = db
      .select()
      .from(invites)
      .where(eq(invites.id, context.req.param("id")))
      .get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    if (row.acceptedAt !== null) {
      return context.json({ error: "already_accepted" }, 409);
    }

    if (row.revokedAt === null) {
      const revokedAt = new Date(clock.now());

      db.update(invites).set({ revokedAt }).where(eq(invites.id, row.id)).run();

      recordAdminAudit(db, clock, {
        actorId: owner.userId,
        action: "invites.revoke",
        reason: `Revoked the invitation for ${row.id}`,
        detail: { inviteId: row.id },
      });

      const revoked = db.select().from(invites).where(eq(invites.id, row.id)).get();

      if (revoked === undefined) {
        return context.json({ error: "not_found" }, 404);
      }

      return context.json({ invite: await invitationView(revoked, owner.userId) });
    }

    return context.json({ invite: await invitationView(row, owner.userId) });
  });

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

  routes.get("/attempts", zValidator("query", attemptsQuery), (context) => {
    const { applicationId, limit } = context.req.valid("query");

    const rows = db
      .select({
        attempt: attempts,
        ats: postings.ats,
        postingTitle: postings.title,
      })
      .from(attempts)
      .innerJoin(applications, eq(attempts.applicationId, applications.id))
      .innerJoin(postings, eq(applications.postingId, postings.id))
      .where(applicationId === undefined ? undefined : eq(attempts.applicationId, applicationId))
      .orderBy(desc(attempts.startedAt))
      .limit(limit)
      .all();

    return context.json({
      attempts: rows.map((row) => ({
        applicationId: row.attempt.applicationId,
        ats: row.ats,
        browserMs: row.attempt.browserMs,
        costMicros: row.attempt.costMicros,
        endedAt: row.attempt.endedAt,
        id: row.attempt.id,
        outcome: row.attempt.outcome,
        postingTitle: row.postingTitle,
        provider: row.attempt.provider,
        providerSessionId: row.attempt.providerSessionId,
        proxyBytes: row.attempt.proxyBytes,
        startedAt: row.attempt.startedAt,
        liveUrl: `/admin/api/attempts/${row.attempt.id}/live`,
        replayUrl: `/admin/api/attempts/${row.attempt.id}/replay`,
      })),
    });
  });

  routes.get("/attempts/:id/live", async (context) => {
    const attempt = db
      .select()
      .from(attempts)
      .where(eq(attempts.id, context.req.param("id")))
      .get();

    if (attempt === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const sessionId = attempt.providerSessionId;

    if (sessionId === null) {
      return context.json({ error: "not_found" }, 404);
    }

    const provider = deps.providers?.all().find((candidate) => candidate.id === attempt.provider);

    if (provider === undefined) {
      return context.json({ error: "provider_unavailable" }, 404);
    }

    const view = await provider.view(sessionId);

    if (view === null) {
      return context.json({ error: "not_found" }, 404);
    }

    return context.json(view);
  });

  routes.get("/attempts/:id/replay", async (context) => {
    const attempt = db
      .select()
      .from(attempts)
      .where(eq(attempts.id, context.req.param("id")))
      .get();

    if (attempt === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const sessionId = attempt.providerSessionId;

    if (sessionId === null) {
      return context.json({ error: "not_found" }, 404);
    }

    const provider = deps.providers?.all().find((candidate) => candidate.id === attempt.provider);

    if (provider === undefined) {
      return context.json({ error: "provider_unavailable" }, 404);
    }

    const view = await provider.view(sessionId);
    const recordingUrl = view?.recordingUrl ?? null;

    if (recordingUrl === null) {
      return context.json({ error: "not_found" }, 404);
    }

    return context.json({ recordingUrl });
  });

  routes.get("/provider-report", (context) =>
    context.json({ providers: buildProviderReport(db, clock) }),
  );

  routes.get("/live-checks", (context) => context.json({ results: readLiveCheckResults(db, 100) }));

  routes.post("/live-checks", (context) => {
    const owner = context.get("owner");
    const job = enqueueLiveCheckNow(db, clock);

    recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "live-checks.run",
      reason: "Run the daily live checks now",
      detail: { jobId: job.id },
    });

    return context.json({ jobId: job.id });
  });

  routes.post("/fixtures/capture", zValidator("json", captureBody), (context) => {
    if (deps.providers === null) {
      return context.json({ error: "browser_provider_unconfigured" }, 503);
    }

    const owner = context.get("owner");

    const input = context.req.valid("json");

    const job = enqueueJob(db, clock, FIXTURE_CAPTURE_JOB_KIND, JSON.stringify(input), {
      maxAttempts: 1,
    });

    recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "fixtures.capture",
      reason: `Capture ${input.ats} forms for the test fixtures`,
      detail: { ats: input.ats, applyUrls: input.applyUrls.length, jobId: job.id },
    });

    return context.json({ jobId: job.id });
  });

  return routes;
}
