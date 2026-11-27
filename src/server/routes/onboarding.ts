import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { validJson } from "./validators.ts";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import { readSessionUser } from "../auth/session.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { ReviewService } from "../pipeline/reviews.ts";
import type { MatchingService } from "../matching/score.ts";
import type { SpendGate } from "../billing/spend.ts";

import { retryWhenBusy } from "../platform/db/busy.ts";
import { applicationsLeft } from "../billing/ledger.ts";
import { postingUserState } from "../platform/db/schema.ts";
import { postings } from "../platform/db/catalog-schema.ts";
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
import { createSkipCompanyService } from "../profile/skip-companies.ts";
import { countMatchingJobs, createTargetsService } from "../profile/targets.ts";
import { describePlaceIds } from "../places/catalog.ts";
import { masterKeyring } from "../config/env.ts";
import { demoLocked } from "../demo/guard.ts";
import {
  ONBOARDING_MATCH_PICK_LIMIT,
  ONBOARDING_STEP_COUNT,
  onboardingCurrentEmployerInputSchema,
  onboardingFactsInputSchema,
  onboardingGapsInputSchema,
  onboardingMatchSelectionInputSchema,
  onboardingPrepareInputSchema,
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
  reviews: ReviewService;
  spendGate?: SpendGate | undefined;
  matching: MatchingService;
}) {
  const { db, clock, auth, llm, objects, reviews: reviewService } = deps;

  const personal = deps.personal ?? createPersonalCrypto(db, masterKeyring);

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

    return {
      matchedCount: countMatchingJobs(deps.db, targets),
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

  function savedPostingIds(userId: string) {
    return db
      .select({ postingId: postingUserState.postingId })
      .from(postingUserState)
      .where(and(eq(postingUserState.userId, userId), eq(postingUserState.state, "saved")))
      .all()
      .map((row) => row.postingId);
  }

  async function matchesView(userId: string) {
    const preview = await deps.matching.preview(userId, 9);
    const saved = savedPostingIds(userId);

    const selectableIds = new Set(
      preview.items.slice(0, ONBOARDING_MATCH_PICK_LIMIT).map((item) => item.id),
    );

    return {
      matches: preview.items,
      pickLimit: ONBOARDING_MATCH_PICK_LIMIT,
      poolCount: preview.poolCount,
      selected: saved.filter((id) => selectableIds.has(id)),
    };
  }

  function saveSelection(userId: string, postingIds: readonly string[]) {
    const unique = [...new Set(postingIds)];

    if (unique.length > 0) {
      const open = deps.catalogDb
        .select({ id: postings.id })
        .from(postings)
        .where(and(inArray(postings.id, unique), eq(postings.status, "open")))
        .all()
        .map((row) => row.id);

      if (open.length !== unique.length) {
        return null;
      }
    }

    db.transaction((tx) => {
      tx.delete(postingUserState)
        .where(and(eq(postingUserState.userId, userId), eq(postingUserState.state, "saved")))
        .run();

      for (const postingId of unique) {
        tx.insert(postingUserState)
          .values({ userId, postingId, state: "saved", updatedAt: clock.now() })
          .run();
      }
    });

    return unique;
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

      const saved = saveSelection(account.id, context.req.valid("json").postingIds);

      if (saved === null) {
        return context.json({ error: API_ERRORS.notFound }, 404);
      }

      context.header("Cache-Control", "no-store");

      return context.json(await matchesView(account.id));
    },
  );

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

    if (postingIds.length === 0) {
      return context.json({ error: "selection_required" }, 409);
    }

    await retryWhenBusy(() => startOnboarding(db, clock, account.id), "onboarding.start");

    const prepared = await deps.matching.prepareChosen(
      account.id,
      postingIds.slice(0, ONBOARDING_MATCH_PICK_LIMIT),
    );

    context.header("Cache-Control", "no-store");

    return context.json({ onboarding: await view(account), prepared: prepared.length });
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
