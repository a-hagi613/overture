import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { ReviewService } from "../pipeline/reviews.ts";

import { createOnboardingProgressService } from "../profile/onboarding-progress.ts";
import { createOnboardingStepService } from "../profile/onboarding-step.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { createResumeService } from "../profile/resume.ts";
import { createSkipCompanyService } from "../profile/skip-companies.ts";
import { createTargetsService } from "../profile/targets.ts";
import { env } from "../config/env.ts";
import { parseMasterKey } from "../platform/crypto.ts";
import { ONBOARDING_STEP_COUNT, onboardingFactsInputSchema } from "../../shared/onboarding.ts";

export function createOnboardingRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  auth: Auth;
  llm: LlmPort;
  objects: ObjectStore;
  reviews: ReviewService;
}) {
  const { db, clock, auth, llm, objects, reviews: reviewService } = deps;

  const personal = createPersonalCrypto(
    db,
    parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
    env.MASTER_KEY_CURRENT,
  );

  const targetsService = createTargetsService({ db, clock });
  const progress = createOnboardingProgressService({ db, clock });
  const resumes = createResumeService({ db, clock, objects, personal, llm });
  const skipCompanies = createSkipCompanyService({ db, clock });

  const step = createOnboardingStepService({
    db,
    clock,
    personal,
    readTargets: targetsService.read,
    reviewService,
  });

  async function view(account: { id: string; role?: string | null }) {
    const state = await progress.read(account.id);
    const resume = await resumes.current(account.id);
    const skipList = await skipCompanies.list(account.id);

    return {
      currentEmployer:
        skipList.find((company) => company.reason === "current_employer")?.name ?? null,
      needsOnboarding:
        account.role !== "owner" &&
        state.step < ONBOARDING_STEP_COUNT &&
        state.onboardedAt === null,
      onboardedAt: state.onboardedAt,
      pauseReason: state.pauseReason,
      resume,
      skipCompanies: skipList,
      step: state.step,
    };
  }

  const routes = new Hono();

  routes.get("/onboarding", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json(await view(account));
  });

  routes.post("/onboarding/:step", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const finished = Number(context.req.param("step"));

    if (!Number.isInteger(finished) || finished < 1 || finished > ONBOARDING_STEP_COUNT) {
      return context.json({ error: "unknown_step" }, 400);
    }

    if (finished === 2 && (await resumes.current(account.id)) === null) {
      return context.json({ error: "resume_required" }, 409);
    }

    await progress.finish(account.id, finished);

    return context.json(await view(account));
  });

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
