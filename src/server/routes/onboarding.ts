import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { ReviewService } from "../pipeline/reviews.ts";

import { createOnboardingStepService } from "../profile/onboarding-step.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { createTargetsService } from "../profile/targets.ts";
import { env } from "../config/env.ts";
import { parseMasterKey } from "../platform/crypto.ts";
import { onboardingFactsInputSchema } from "../../shared/onboarding.ts";

export function createOnboardingRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  auth: Auth;
  reviews: ReviewService;
}) {
  const { db, clock, auth, reviews: reviewService } = deps;

  const personal = createPersonalCrypto(
    db,
    parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
    env.MASTER_KEY_CURRENT,
  );

  const targetsService = createTargetsService({ db, clock });

  const step = createOnboardingStepService({
    db,
    clock,
    personal,
    readTargets: targetsService.read,
    reviewService,
  });

  const routes = new Hono();

  routes.get("/onboarding/facts", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json(await step.read(account.id));
  });

  routes.put(
    "/onboarding/facts",
    zValidator("json", onboardingFactsInputSchema),
    async (context) => {
      const account = await sessionUser(auth, context.req.raw);

      if (account === null) {
        return context.json({ error: "unauthorised" }, 401);
      }

      return context.json(await step.save(account.id, context.req.valid("json")));
    },
  );

  return routes;
}

async function sessionUser(auth: Auth, raw: Request) {
  const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

  return result?.user ?? null;
}
