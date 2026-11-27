import { Hono } from "hono";
import { validJson } from "./validators.ts";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import { readSessionUser } from "../auth/session.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { Payments } from "../platform/ports/payments.ts";
import type { ReviewService } from "../pipeline/reviews.ts";
import type { SpendGate } from "../billing/spend.ts";

import { retryWhenBusy } from "../platform/db/busy.ts";
import { logError } from "../platform/log.ts";
import { applicationsLeft } from "../billing/ledger.ts";
import { startOnboarding } from "../profile/onboarding-start.ts";
import { enqueueUserPull } from "../jobs/pull.ts";
import { enqueueMatchScorePool } from "../matching/match-jobs.ts";
import { preferencesChanged } from "../jobs/preferences.ts";
import { createConsentService } from "../profile/consent.ts";
import { createLanguagesService } from "../profile/languages.ts";
import { createOnboardingProgressService } from "../profile/onboarding-progress.ts";
import { createOnboardingStepService } from "../profile/onboarding-step.ts";
import { createOnboardingGapsService } from "../profile/onboarding-gaps.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import { createResumeService } from "../profile/resume.ts";
import { createSkipCompanyService, normalizeCompanyName } from "../profile/skip-companies.ts";
import { countMatchingJobs, createTargetsService } from "../profile/targets.ts";
import { createOnboardingPicks } from "../onboarding/picks.ts";
import { onboardingMatchesOf } from "../onboarding/freehire-matches.ts";
import { preparePickedJobs } from "../onboarding/prepare-picks.ts";
import type { OnboardingPicksService } from "../onboarding/picks.ts";
import { verifyTrialCardForUser } from "../billing/trial-verify.ts";
import { hasTrialGrant } from "../billing/card-fingerprint.ts";
import { createCheckoutCoordinator } from "../billing/checkout.ts";
import { stripePriceId } from "../billing/index.ts";
import { currentSubscriptionOf, subscriptionBlocksCheckout } from "../billing/subscriptions.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { getSettingNumber } from "../platform/settings/index.ts";
import { describePlaceIds } from "../places/catalog.ts";
import { masterKeyring } from "../config/env.ts";
import { demoLocked } from "../demo/guard.ts";
import {
  ONBOARDING_MAX_PICKS,
  ONBOARDING_STEP_COUNT,
  onboardingCheckoutInputSchema,
  onboardingCurrentEmployerInputSchema,
  onboardingFactsInputSchema,
  onboardingGapsInputSchema,
  onboardingMatchSelectionInputSchema,
  onboardingPickLimitFor,
  onboardingPlanInputSchema,
  onboardingPrepareInputSchema,
  onboardingSettleInputSchema,
  onboardingTimezoneInputSchema,
} from "../../shared/onboarding.ts";
import { targetsInputSchema } from "../../shared/targets.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

export function createOnboardingRoutes(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  auth: Auth;
  llm: LlmPort;
  objects: ObjectStore;
  personal?: PersonalCrypto | undefined;
  payments?: Payments | null | undefined;
  cardFingerprintSecret?: string | null | undefined;
  reviews: ReviewService;
  spendGate?: SpendGate | undefined;
  appOrigin?: string | undefined;
}) {
  const { db, clock, auth, llm, objects, reviews: reviewService } = deps;

  const personal = deps.personal ?? createPersonalCrypto(db, masterKeyring);
  const payments = deps.payments ?? null;
  const cardFingerprintSecret = deps.cardFingerprintSecret ?? null;
  const appOrigin = (deps.appOrigin ?? "http://localhost:3000").replace(/\/+$/u, "");
  const checkout = payments === null ? null : createCheckoutCoordinator({ clock, db, payments });
  const picks = createOnboardingPicks({ clock, db });

  const targetsService = createTargetsService({ db, clock });
  const languagesService = createLanguagesService({ db, clock });
  const progress = createOnboardingProgressService({ db, clock });

  const resumes = createResumeService({
    db,
    clock,
    objects,
    personal,
    llm,
    spendGate: deps.spendGate,
  });

  const skipCompanies = createSkipCompanyService({ db, catalogDb: deps.catalogDb, clock });
  const consent = createConsentService({ db, clock });

  const gaps = createOnboardingGapsService({ db, clock, personal, skipCompanies });

  const step = createOnboardingStepService({
    db,
    catalogDb: deps.catalogDb,
    clock,
    personal,
    readTargets: targetsService.read,
    reviewService,
  });

  async function ensureLanguages(userId: string, readOnly: boolean) {
    const { languages } = await languagesService.read(userId);

    if (languages.length > 0) {
      return languages;
    }

    if (readOnly) {
      return ["en"];
    }

    return languagesService.saveLanguages(userId, { languages: ["en"] });
  }

  async function targetsView(userId: string) {
    const { targets } = await targetsService.read(userId);
    const { languages } = await languagesService.read(userId);

    return {
      matchedCount: countMatchingJobs(deps.db, targets, languages),
      places: describePlaceIds(targets.locations),
      targets,
    };
  }

  async function view(account: { id: string; role?: string | null }) {
    const state = await progress.read(account.id);
    const resume = await resumes.current(account.id);
    const skipList = await skipCompanies.list(account.id);

    return {
      applicationsLeft: applicationsLeft(db, account.id, clock.now()),
      currentEmployer:
        skipList.find((company) => company.reason === "current_employer")?.name ?? null,
      needsOnboarding: account.role !== "owner" && state.onboardedAt === null,
      onboardedAt: state.onboardedAt,
      pauseReason: state.pauseReason,
      resume,
      skipCompanies: skipList,
      step: state.step,
    };
  }

  async function matchesView(userId: string) {
    const durable = picks.view(userId);
    const { targets } = await targetsService.read(userId);
    const { languages } = await languagesService.read(userId);
    const matches = onboardingMatchesOf(
      { db, strongThreshold: getSettingNumber(db, "match.strong") },
      userId,
      Math.max(durable.pickLimit, ONBOARDING_MAX_PICKS),
    );

    const selectableIds = new Set(matches.slice(0, durable.pickLimit).map((item) => item.id));

    return {
      matches,
      pickLimit: durable.pickLimit,
      picks: durable,
      planKind: durable.planKind,
      poolCount: countMatchingJobs(db, targets, languages),
      selected: durable.selected.filter((id) => selectableIds.has(id)),
      trialAvailable: durable.planKind === "free_trial" || !hasTrialGrant(db, userId),
    };
  }

  async function prepareStoredPicks(userId: string) {
    const stored = picks.forPreparation(userId);

    if (stored.length === 0) {
      return { prepared: 0, results: new Map() };
    }

    picks.markStatus(userId, "preparing");

    const skipNames = new Set(
      (await skipCompanies.list(userId)).map((company) => normalizeCompanyName(company.name)),
    );
    const results = await preparePickedJobs({ db, clock }, userId, stored, skipNames);

    picks.applyPreparation(userId, results);

    const prepared = [...results.values()].filter(
      (result) =>
        result.status === "prepared" ||
        result.status === "preparing" ||
        result.status === "needs_answer",
    ).length;

    return { prepared, results };
  }

  const routes = new Hono();

  routes.get("/onboarding", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json(await view(account));
  });

  routes.post("/onboarding/start", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    if (!account.emailVerified) {
      return context.json({ error: "email_unverified" }, 403);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    const state = consent.read(account.id);

    if (state.accepted?.version !== state.current.version) {
      return context.json({ error: "consent_required" }, 409);
    }

    await retryWhenBusy(() => startOnboarding(db, clock, account.id), "onboarding.start");

    context.header("Cache-Control", "no-store");

    return context.json(await view(account));
  });

  routes.get("/onboarding/matches", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    context.header("Cache-Control", "no-store");

    return context.json(await matchesView(account.id));
  });

  routes.put(
    "/onboarding/matches",
    validJson(onboardingMatchSelectionInputSchema),
    async (context) => {
      const account = await readSessionUser(auth, context.req.raw.headers);

      if (account === null) {
        return context.json({ error: API_ERRORS.signInRequired }, 401);
      }

      const state = await progress.read(account.id);

      if (state.onboardedAt !== null) {
        return context.json({ error: "already_onboarded" }, 409);
      }

      const postingIds = [...new Set(context.req.valid("json").postingIds)];
      const limit = onboardingPickLimitFor(picks.planKindOf(account.id));

      if (postingIds.length > limit) {
        return context.json({ error: "pick_limit", limit }, 409);
      }

      const saved = picks.save(account.id, postingIds);

      if (saved === null) {
        return context.json({ error: API_ERRORS.notFound }, 404);
      }

      context.header("Cache-Control", "no-store");

      return context.json(await matchesView(account.id));
    },
  );

  routes.put("/onboarding/plan", validJson(onboardingPlanInputSchema), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const state = await progress.read(account.id);

    if (state.onboardedAt !== null) {
      return context.json({ error: "already_onboarded" }, 409);
    }

    const { planKind } = context.req.valid("json");

    if (planKind === "free_trial") {
      const alreadyOnTrial = picks.planKindOf(account.id) === "free_trial";

      if (!alreadyOnTrial && hasTrialGrant(db, account.id)) {
        return context.json({ error: "trial_used" }, 409);
      }
    }

    const limit = onboardingPickLimitFor(planKind);

    if (picks.forPreparation(account.id).length > limit) {
      return context.json({ error: "pick_limit", limit }, 409);
    }

    picks.setPlanKind(account.id, planKind);

    context.header("Cache-Control", "no-store");

    return context.json(await matchesView(account.id));
  });

  routes.post("/onboarding/checkout", validJson(onboardingCheckoutInputSchema), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    if (!account.emailVerified) {
      return context.json({ error: "email_unverified" }, 403);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    const state = await progress.read(account.id);

    if (state.onboardedAt !== null) {
      return context.json({ error: "already_onboarded" }, 409);
    }

    const consentState = consent.read(account.id);

    if (consentState.accepted?.version !== consentState.current.version) {
      return context.json({ error: "consent_required" }, 409);
    }

    if (checkout === null) {
      return context.json({ error: "billing_disabled" }, 503);
    }

    const stored = picks.forPreparation(account.id);

    if (stored.length === 0) {
      return context.json({ error: "no_picks" }, 409);
    }

    const { plan } = context.req.valid("json");

    if (stored.length > onboardingPickLimitFor(plan)) {
      return context.json({ error: "pick_limit", limit: onboardingPickLimitFor(plan) }, 409);
    }

    const existing = currentSubscriptionOf(db, account.id);

    if (existing !== null && subscriptionBlocksCheckout(existing.status)) {
      return context.json(
        { error: "plan_active", plan: existing.plan, status: existing.status },
        409,
      );
    }

    const priceId = stripePriceId(plan);

    if (priceId === null) {
      return context.json({ error: "billing_not_configured" }, 503);
    }

    picks.setPlanKind(account.id, plan);

    try {
      const session = await checkout.create({
        cancelUrl: `${appOrigin}/onboarding/matches?card=cancelled`,
        email: account.email,
        plan,
        priceId,
        successUrl: `${appOrigin}/tracker?billing=success&plan=${plan}`,
        userId: account.id,
      });

      context.header("Cache-Control", "no-store");

      return context.json({ url: session.url });
    } catch (error) {
      logError("onboarding.checkout", error);

      return context.json({ error: "stripe_error" }, 502);
    }
  });

  routes.post(
    "/onboarding/current-employer",
    validJson(onboardingCurrentEmployerInputSchema),
    async (context) => {
      const account = await readSessionUser(auth, context.req.raw.headers);

      if (account === null) {
        return context.json({ error: API_ERRORS.signInRequired }, 401);
      }

      await skipCompanies.setCurrentEmployer(account.id, context.req.valid("json").name);

      return context.json(await view(account));
    },
  );

  routes.post("/onboarding/prepare", validJson(onboardingPrepareInputSchema), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    if (!account.emailVerified) {
      return context.json({ error: "email_unverified" }, 403);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    const consentState = consent.read(account.id);

    if (consentState.accepted?.version !== consentState.current.version) {
      return context.json({ error: "consent_required" }, 409);
    }

    if (applicationsLeft(db, account.id, clock.now()) <= 0) {
      return context.json({ error: "trial_required" }, 402);
    }

    const postingIds = [...new Set(context.req.valid("json").postingIds)];
    const stored = picks.forPreparation(account.id);
    const limit = onboardingPickLimitFor(picks.planKindOf(account.id));

    if (postingIds.length > limit || stored.length > limit) {
      return context.json({ error: "pick_limit", limit }, 409);
    }

    if (postingIds.length === 0 && stored.length === 0) {
      return context.json({ error: "selection_required" }, 409);
    }

    if (stored.length === 0) {
      const saved = picks.save(account.id, postingIds);

      if (saved === null) {
        return context.json({ error: API_ERRORS.notFound }, 404);
      }
    }

    await retryWhenBusy(() => startOnboarding(db, clock, account.id), "onboarding.start");

    const { prepared } = await prepareStoredPicks(account.id);

    context.header("Cache-Control", "no-store");

    return context.json({
      onboarding: await view(account),
      picks: picks.view(account.id),
      prepared,
    });
  });

  routes.post("/onboarding/settle", validJson(onboardingSettleInputSchema), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    context.header("Cache-Control", "no-store");

    const stored = picks.forPreparation(account.id);

    if (stored.length > onboardingPickLimitFor(picks.planKindOf(account.id))) {
      return context.json({ error: "pick_limit" }, 409);
    }

    if (stored.length === 0) {
      return context.json(
        {
          applicationsLeft: applicationsLeft(db, account.id, clock.now()),
          outcome: "no_picks",
          picks: picks.view(account.id),
          prepared: 0,
        },
        409,
      );
    }

    const { sessionId } = context.req.valid("json");

    if (sessionId !== undefined && applicationsLeft(db, account.id, clock.now()) <= 0) {
      const verified = await verifyTrialCardForUser(
        { cardFingerprintSecret, clock, db, payments },
        { sessionId, userId: account.id },
      );

      if (verified.outcome === "stripe_error") {
        return context.json({ error: "stripe_error" }, 502);
      }

      if (verified.outcome === "billing_disabled") {
        return context.json({ error: "billing_disabled" }, 503);
      }

      if (verified.outcome === "pending") {
        return context.json(
          { applicationsLeft: 0, outcome: "pending", picks: picks.view(account.id), prepared: 0 },
          202,
        );
      }

      if (verified.outcome === "card_not_verified") {
        return context.json(
          {
            applicationsLeft: applicationsLeft(db, account.id, clock.now()),
            error: "card_not_verified",
            outcome: verified.outcome,
            picks: picks.view(account.id),
            prepared: 0,
          },
          402,
        );
      }

      if (verified.outcome !== "granted") {
        return context.json(
          {
            applicationsLeft: applicationsLeft(db, account.id, clock.now()),
            error: verified.outcome,
            outcome: verified.outcome,
            picks: picks.view(account.id),
            prepared: 0,
          },
          409,
        );
      }

      publishEvent(
        db,
        clock,
        "billing.updated",
        JSON.stringify({ billing: true, trial: true }),
        account.id,
      );
    }

    if (applicationsLeft(db, account.id, clock.now()) <= 0) {
      if (sessionId === undefined) {
        return context.json(
          {
            applicationsLeft: 0,
            outcome: "pending",
            picks: picks.view(account.id),
            prepared: 0,
          },
          202,
        );
      }

      return context.json({ error: "trial_required", outcome: "trial_required" }, 402);
    }

    await retryWhenBusy(() => startOnboarding(db, clock, account.id), "onboarding.start");

    const { prepared } = await prepareStoredPicks(account.id);

    publishEvent(db, clock, "home.updated", JSON.stringify({ prepared }), account.id);
    publishEvent(db, clock, "application.updated", JSON.stringify({ prepared }), account.id);

    return context.json({
      applicationsLeft: applicationsLeft(db, account.id, clock.now()),
      outcome: "prepared",
      picks: picks.view(account.id),
      prepared,
    });
  });

  routes.post("/onboarding/:step", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const finished = Number(context.req.param("step"));

    if (!Number.isInteger(finished) || finished < 1 || finished > ONBOARDING_STEP_COUNT) {
      return context.json({ error: "unknown_step" }, 400);
    }

    if (finished === ONBOARDING_STEP_COUNT) {
      return context.json({ error: "start_required" }, 409);
    }

    if ((finished === 2 || finished === 3) && (await resumes.current(account.id)) === null) {
      return context.json({ error: "resume_required" }, 409);
    }

    if (finished === 4) {
      const { targets } = await targetsService.read(account.id);

      if (targets.roles.length === 0 || targets.locations.length === 0) {
        return context.json({ error: "targets_required" }, 409);
      }
    }

    await progress.finish(account.id, finished);

    return context.json(await view(account));
  });

  routes.get("/onboarding/targets", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json(await targetsView(account.id));
  });

  routes.put("/onboarding/targets", validJson(targetsInputSchema), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const before = await targetsService.read(account.id);
    const after = await targetsService.save(account.id, context.req.valid("json"));

    if (preferencesChanged(before.targets, after.targets)) {
      enqueueUserPull(db, clock, account.id);
      enqueueMatchScorePool(db, clock, account.id);
    }

    return context.json(await targetsView(account.id));
  });

  routes.put("/onboarding/timezone", validJson(onboardingTimezoneInputSchema), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const languages = await ensureLanguages(account.id, false);

    return context.json(
      await languagesService.save(account.id, {
        languages,
        timezone: context.req.valid("json").timezone,
      }),
    );
  });

  routes.get("/onboarding/facts", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json(await step.read(account.id));
  });

  routes.put("/onboarding/facts", validJson(onboardingFactsInputSchema), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    return context.json(await step.save(account.id, context.req.valid("json")));
  });

  routes.get("/onboarding/gaps", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    context.header("Cache-Control", "no-store");

    return context.json(await gaps.read(account.id));
  });

  routes.put("/onboarding/gaps", validJson(onboardingGapsInputSchema), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    context.header("Cache-Control", "no-store");

    return context.json(await gaps.save(account.id, context.req.valid("json")));
  });

  return routes;
}
