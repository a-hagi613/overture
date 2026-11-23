import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import { readSessionUser } from "../auth/session.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";

import { codePatterns } from "../inbox/codes.ts";
import { resolveCodeWaitWithPaste } from "../inbox/waits.ts";
import { applications, attempts, codeWaits } from "../platform/db/schema.ts";
import { isDemoRole } from "../../shared/demo.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";
import { CODE_WAIT_ERRORS } from "../../shared/code-wait.ts";

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

  routes.get("/profile/mailbox", async (context) => {
    if (!secretSet) {
      return context.json({ error: "inbound_not_configured" }, 503);
    }

    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const mailbox = isDemoRole(user.role)
      ? mailboxes.readFor(user.id)
      : await mailboxes.ensureFor(user.id);

    if (mailbox === null) {
      return context.json({ address: "", firstForwardedAt: null, forwardingWorks: false });
    }

    return context.json({
      address: mailbox.address,
      firstForwardedAt: mailbox.firstForwardedAt,
      forwardingWorks: mailbox.firstForwardedAt !== null,
    });
  });

  routes.get("/mail/code-waits", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const rows = db
      .select({
        id: codeWaits.id,
        attemptId: codeWaits.attemptId,
        startedAt: codeWaits.startedAt,
        expiresAt: codeWaits.expiresAt,
        applicationId: applications.id,
        company: applications.companyName,
        title: applications.postingTitle,
      })
      .from(codeWaits)
      .innerJoin(attempts, eq(attempts.id, codeWaits.attemptId))
      .innerJoin(applications, eq(applications.id, attempts.applicationId))
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
      now: clock.now(),
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

  routes.post("/mail/code-waits/:id", validJson(codeBodySchema), async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const { code } = context.req.valid("json");
    const { id } = context.req.param();

    const result = await resolveCodeWaitWithPaste(
      { db, clock, personal },
      { userId: user.id, waitId: id, code },
    );

    if (result.outcome === "not_found") {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    if (result.outcome === "already_resolved") {
      return context.json({ error: CODE_WAIT_ERRORS.alreadyResolved }, 409);
    }

    if (result.outcome === "expired") {
      return context.json({ error: CODE_WAIT_ERRORS.expired }, 409);
    }

    return context.json({
      id: result.waitId,
      resolvedAt: result.resolvedAt,
      resolvedBy: result.resolvedBy,
    });
  });

  return routes;
}
