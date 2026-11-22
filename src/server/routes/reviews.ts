import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import { readSessionUser } from "../auth/session.ts";
import type { ReviewService } from "../pipeline/reviews.ts";
import { demoLocked } from "../demo/guard.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const answerBody = z.object({ value: z.string().trim().min(1).max(2000) });

export function createReviewRoutes(deps: { auth: Auth; reviews: ReviewService }) {
  const { auth, reviews } = deps;

  const routes = new Hono();

  routes.get("/reviews", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const list = reviews.list(account.id);

    return context.json({
      reviews: list,
      totalApplications: list.reduce((total, review) => total + review.unlocked, 0),
    });
  });

  routes.post("/reviews/:id/answer", validJson(answerBody), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    const { id } = context.req.param();
    const { value } = context.req.valid("json");
    const answered = await reviews.answer(account.id, id, value);

    if (answered === null) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return context.json(answered);
  });

  routes.post("/reviews/:id/dismiss", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const { id } = context.req.param();
    const dismissed = reviews.dismiss(account.id, id);

    if (dismissed === null) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return context.json(dismissed);
  });

  return routes;
}
