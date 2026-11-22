import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { CHECKIN_ANSWERS } from "../../shared/checkins.ts";
import { answerCheckin } from "../pipeline/checkins.ts";

const answerBody = z.object({ answer: z.enum(CHECKIN_ANSWERS) });

export function createCheckinRoutes(deps: { db: AppDatabase; clock: Clock; auth: Auth }) {
  const { db, clock, auth } = deps;

  const routes = new Hono();

  routes.post("/checkins/:id", validJson(answerBody), async (context) => {
    const session = await auth.api
      .getSession({ headers: context.req.raw.headers })
      .catch(() => null);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();
    const { answer } = context.req.valid("json");
    const result = answerCheckin({ db, clock }, { answer, checkinId: id, userId: session.user.id });

    if (result === null) {
      return context.json({ error: "not_found" }, 404);
    }

    return context.json(result);
  });

  return routes;
}
