import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";

import { codePatterns } from "../inbox/codes.ts";
import { resolveCodeWaitWithPaste } from "../inbox/waits.ts";
import { applications, attempts, codeWaits, companies, postings } from "../platform/db/schema.ts";

const codeBodySchema = z.object({
  code: z.string().regex(codePatterns.greenhouse, "Enter the 8-character code."),
});

export function createMailRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  auth: Auth;
  personal: PersonalCrypto;
  mailboxes: ReturnType<typeof createMailboxService>;
  secretSet: boolean;
}) {
  const { db, clock, auth, personal, mailboxes, secretSet } = deps;
  const routes = new Hono();

  async function sessionUser(raw: Request) {
    const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

    return result?.user ?? null;
  }

  routes.get("/profile/mailbox", async (context) => {
    if (!secretSet) {
      return context.json({ error: "inbound_not_configured" }, 503);
    }

    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const mailbox = await mailboxes.ensureFor(user.id);

    return context.json({ address: mailbox.address });
  });

  routes.get("/mail/code-waits", async (context) => {
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const rows = db
      .select({
        id: codeWaits.id,
        attemptId: codeWaits.attemptId,
        startedAt: codeWaits.startedAt,
        expiresAt: codeWaits.expiresAt,
        applicationId: applications.id,
        company: companies.name,
        title: postings.title,
      })
      .from(codeWaits)
      .innerJoin(attempts, eq(attempts.id, codeWaits.attemptId))
      .innerJoin(applications, eq(applications.id, attempts.applicationId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .where(
        and(
          eq(codeWaits.userId, user.id),
          isNull(codeWaits.resolvedAt),
          gt(codeWaits.expiresAt, new Date(clock.now())),
        ),
      )
      .orderBy(asc(codeWaits.startedAt))
      .all();

    return context.json({
      waits: rows.map((row) => ({
        id: row.id,
        attemptId: row.attemptId,
        applicationId: row.applicationId,
        company: row.company,
        title: row.title,
        startedAt: row.startedAt.getTime(),
        expiresAt: row.expiresAt.getTime(),
      })),
    });
  });

  routes.post("/mail/code-waits/:id", zValidator("json", codeBodySchema), async (context) => {
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const { code } = context.req.valid("json");
    const { id } = context.req.param();

    const result = await resolveCodeWaitWithPaste(
      { db, clock, personal },
      { userId: user.id, waitId: id, code },
    );

    if (result.outcome === "not_found") {
      return context.json({ error: "not found" }, 404);
    }

    if (result.outcome === "already_resolved") {
      return context.json({ error: "already resolved" }, 409);
    }

    if (result.outcome === "expired") {
      return context.json({ error: "expired" }, 409);
    }

    return context.json({
      id: result.waitId,
      resolvedAt: result.resolvedAt,
      resolvedBy: result.resolvedBy,
    });
  });

  return routes;
}
