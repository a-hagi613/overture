import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { ReviewService } from "../pipeline/reviews.ts";
import type { SpendGate } from "../billing/spend.ts";

import { env } from "../config/env.ts";
import { demoLocked } from "../demo/guard.ts";
import { parseMasterKey } from "../platform/crypto.ts";
import { createFactService } from "../profile/facts.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { createResumeService, MAX_RESUME_BYTES } from "../profile/resume.ts";
import { createLanguagesService } from "../profile/languages.ts";
import { createSkipCompanyService } from "../profile/skip-companies.ts";
import { createStrengthenService } from "../profile/strengthen.ts";
import { countMatchingPostings, createTargetsService } from "../profile/targets.ts";
import { returnStaleApprovals } from "../pipeline/approval-invalidation.ts";
import { TIER_2_FACT_KEYS } from "../../shared/facts.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";
import {
  languagesInputSchema,
  profileSettingsInputSchema,
  skipCompaniesInputSchema,
  targetsInputSchema,
} from "../../shared/targets.ts";

const strengthenSchema = z.object({
  key: z.enum(TIER_2_FACT_KEYS),
  value: z.string().trim().min(1).max(2000),
});

const uploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => file.size <= MAX_RESUME_BYTES, "PDF must be 10 MB or smaller")
    .refine((file) => file.type === "application/pdf", "Only PDF resumes are accepted"),
});

const factsSchema = z.object({
  facts: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string().max(2000),
        scope: z
          .string()
          .regex(/^(?:|[A-Z]{2}|[A-Z]{3})$/u)
          .default(""),
      }),
    )
    .max(64),
});

export function createProfileRoutes(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  auth: Auth;
  objects: ObjectStore;
  llm: LlmPort;
  reviews: ReviewService;
  spendGate?: SpendGate | undefined;
}) {
  const { db, clock, auth, objects, llm } = deps;

  const personal = createPersonalCrypto(
    db,
    parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
    env.MASTER_KEY_CURRENT,
  );

  const resumesService = createResumeService({
    db,
    clock,
    objects,
    personal,
    llm,
    spendGate: deps.spendGate,
  });

  const factsService = createFactService({ db, clock, personal });

  const strengthenService = createStrengthenService({
    db,
    clock,
    personal,
    reviewService: deps.reviews,
  });

  const targetsService = createTargetsService({ db, clock });

  const languagesService = createLanguagesService({ db, clock });

  const skipCompanyService = createSkipCompanyService({ db, catalogDb: deps.catalogDb, clock });

  const routes = new Hono();

  routes.post("/profile/resume", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    const form = await context.req.formData().catch(() => null);
    const parsed = uploadSchema.safeParse({ file: form?.get("file") ?? null });

    if (!parsed.success) {
      return context.json({ error: API_ERRORS.invalidRequest, issues: parsed.error.issues }, 400);
    }

    const upload = await resumesService.upload(account.id, {
      name: parsed.data.file.name === "" ? "resume.pdf" : parsed.data.file.name,
      bytes: new Uint8Array(await parsed.data.file.arrayBuffer()),
    });

    const prefilled = await factsService.prefillFromResume(account.id, upload.text);

    const employer = prefilled.find((fact) => fact.key === "current_employer");

    if (employer !== undefined) {
      await skipCompanyService.setCurrentEmployer(account.id, employer.value);
    }

    await returnStaleApprovals({ clock, db, personal, userId: account.id });

    return context.json(
      { ...upload.resume, prefilledFacts: prefilled.map((fact) => fact.key) },
      201,
    );
  });

  routes.get("/profile/resume", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json(await resumesService.current(account.id));
  });

  routes.get("/profile/resume/:id/file", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    const { id } = context.req.param();
    const file = await resumesService.fileBytes(account.id, id);

    if (file === null) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return new Response(file.bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${file.filename}"`,
      },
    });
  });

  routes.get("/profile/facts", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json({ facts: await factsService.list(account.id) });
  });

  routes.put("/profile/facts", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    let raw: unknown;

    try {
      raw = await context.req.json();
    } catch {
      return context.json({ error: API_ERRORS.invalidRequest }, 400);
    }

    const parsed = factsSchema.safeParse(raw);

    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }

    const body = parsed.data;

    const saved = (
      await Promise.all(
        body.facts.map(async (fact) =>
          factsService.save(account.id, fact.key, fact.value, fact.scope),
        ),
      )
    ).toSorted((left, right) => left.key.localeCompare(right.key));

    await returnStaleApprovals({ clock, db, personal, userId: account.id });

    return context.json({ facts: saved });
  });

  routes.get("/profile/strengthen", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json(await strengthenService.read(account.id));
  });

  routes.put("/profile/strengthen", validJson(strengthenSchema), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const { key, value } = context.req.valid("json");

    return context.json(await strengthenService.save(account.id, key, value));
  });

  routes.get("/profile/languages", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json({ languages: (await languagesService.read(account.id)).languages });
  });

  routes.put("/profile/languages", validJson(languagesInputSchema), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json({
      languages: await languagesService.saveLanguages(account.id, context.req.valid("json")),
    });
  });

  routes.get("/profile/settings", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json(await languagesService.read(account.id));
  });

  routes.put("/profile/settings", validJson(profileSettingsInputSchema), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json(await languagesService.save(account.id, context.req.valid("json")));
  });

  routes.get("/profile/targets", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const saved = await targetsService.read(account.id);
    const { languages } = await languagesService.read(account.id);

    return context.json({
      ...saved,
      matchedCount: countMatchingPostings(deps.catalogDb, saved.targets, languages),
    });
  });

  routes.put("/profile/targets", validJson(targetsInputSchema), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const saved = await targetsService.save(account.id, context.req.valid("json"));
    const { languages } = await languagesService.read(account.id);

    return context.json({
      ...saved,
      matchedCount: countMatchingPostings(deps.catalogDb, saved.targets, languages),
    });
  });

  routes.post("/profile/targets/match-count", validJson(targetsInputSchema), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const { languages } = await languagesService.read(account.id);

    return context.json({
      matchedCount: countMatchingPostings(deps.catalogDb, context.req.valid("json"), languages),
    });
  });

  routes.get("/profile/skip-companies", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json({ companies: await skipCompanyService.list(account.id) });
  });

  routes.put("/profile/skip-companies", validJson(skipCompaniesInputSchema), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json({
      companies: await skipCompanyService.replaceUserCompanies(
        account.id,
        context.req.valid("json"),
      ),
    });
  });

  return routes;
}

async function sessionUser(auth: Auth, raw: Request) {
  const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

  return result?.user ?? null;
}
