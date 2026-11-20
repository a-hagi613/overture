import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { ReviewService } from "../pipeline/reviews.ts";

const answerBody = z.object({ value: z.string().trim().min(1).max(2000) });

export function createReviewRoutes(deps: { auth: Auth; reviews: ReviewService }) {
  const { auth, reviews } = deps;

  const routes = new Hono();

  routes.get("/reviews", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const list = reviews.list(account.id);

    return context.json({
      reviews: list,
      totalApplications: list.reduce((total, review) => total + review.unlocked, 0),
    });
  });

  routes.post("/reviews/:id/answer", zValidator("json", answerBody), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const { id } = context.req.param();
    const { value } = context.req.valid("json");
    const answered = await reviews.answer(account.id, id, value);

    if (answered === null) {
      return context.json({ error: "not found" }, 404);
    }

    return context.json(answered);
  });

  routes.post("/reviews/:id/dismiss", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const { id } = context.req.param();
    const dismissed = reviews.dismiss(account.id, id);

    if (dismissed === null) {
      return context.json({ error: "not found" }, 404);
    }

    return context.json(dismissed);
  });

  return routes;
}

async function sessionUser(auth: Auth, raw: Request) {
  const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

  return result?.user ?? null;
}
