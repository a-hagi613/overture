import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";

import { env } from "../config/env.ts";
import { parseMasterKey } from "../platform/crypto.ts";
import { createFactService } from "../profile/facts.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { createResumeService, MAX_RESUME_BYTES } from "../profile/resume.ts";
import { createLanguagesService } from "../profile/languages.ts";
import { createSkipCompanyService } from "../profile/skip-companies.ts";
import { countMatchingPostings, createTargetsService } from "../profile/targets.ts";
import {
  languagesInputSchema,
  profileSettingsInputSchema,
  skipCompaniesInputSchema,
  targetsInputSchema,
} from "../../shared/targets.ts";

const uploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => file.size <= MAX_RESUME_BYTES, "PDF must be 10 MB or smaller")
    .refine((file) => file.type === "application/pdf", "Only PDF resumes are accepted"),
});

const factsSchema = z.object({
  facts: z.array(z.object({ key: z.string().min(1), value: z.string().max(2000) })).max(64),
});

export function createProfileRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  auth: Auth;
  objects: ObjectStore;
  llm: LlmPort;
}) {
  const { db, clock, auth, objects, llm } = deps;

  const personal = createPersonalCrypto(
    db,
    parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
    env.MASTER_KEY_CURRENT,
  );

  const resumesService = createResumeService({ db, clock, objects, personal, llm });

  const factsService = createFactService({ db, clock, personal });

  const targetsService = createTargetsService({ db, clock });

  const languagesService = createLanguagesService({ db, clock });

  const skipCompanyService = createSkipCompanyService({ db, clock });

  const routes = new Hono();

  routes.post("/profile/resume", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const form = uploadSchema.parse({
      file: (await context.req.formData()).get("file"),
    });

    const upload = await resumesService.upload(account.id, {
      name: form.file.name === "" ? "resume.pdf" : form.file.name,
      bytes: new Uint8Array(await form.file.arrayBuffer()),
    });

    const prefilled = await factsService.prefillFromResume(account.id, upload.text);

    const employer = prefilled.find((fact) => fact.key === "current_employer");

    if (employer !== undefined) {
      await skipCompanyService.setCurrentEmployer(account.id, employer.value);
    }

    return context.json(
      { ...upload.resume, prefilledFacts: prefilled.map((fact) => fact.key) },
      201,
    );
  });

  routes.get("/profile/resume", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json(await resumesService.current(account.id));
  });

  routes.get("/profile/resume/:id/file", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const file = await resumesService.currentFileBytes(account.id);

    if (file === null) {
      return context.json({ error: "not found" }, 404);
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
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json({ facts: await factsService.list(account.id) });
  });

  routes.put("/profile/facts", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const body = factsSchema.parse(await context.req.json());

    const saved = (
      await Promise.all(
        body.facts.map(async (fact) => factsService.save(account.id, fact.key, fact.value)),
      )
    ).toSorted((left, right) => left.key.localeCompare(right.key));

    return context.json({ facts: saved });
  });

  routes.get("/profile/languages", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json({ languages: (await languagesService.read(account.id)).languages });
  });

  routes.put("/profile/languages", zValidator("json", languagesInputSchema), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json({
      languages: await languagesService.saveLanguages(account.id, context.req.valid("json")),
    });
  });

  routes.get("/profile/settings", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json(await languagesService.read(account.id));
  });

  routes.put(
    "/profile/settings",
    zValidator("json", profileSettingsInputSchema),
    async (context) => {
      const account = await sessionUser(auth, context.req.raw);

      if (account === null) {
        return context.json({ error: "unauthorised" }, 401);
      }

      return context.json(await languagesService.save(account.id, context.req.valid("json")));
    },
  );

  routes.get("/profile/targets", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const saved = await targetsService.read(account.id);
    const { languages } = await languagesService.read(account.id);

    return context.json({
      ...saved,
      matchedCount: countMatchingPostings(db, saved.targets, languages),
    });
  });

  routes.put("/profile/targets", zValidator("json", targetsInputSchema), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const saved = await targetsService.save(account.id, context.req.valid("json"));
    const { languages } = await languagesService.read(account.id);

    return context.json({
      ...saved,
      matchedCount: countMatchingPostings(db, saved.targets, languages),
    });
  });

  routes.post(
    "/profile/targets/match-count",
    zValidator("json", targetsInputSchema),
    async (context) => {
      const account = await sessionUser(auth, context.req.raw);

      if (account === null) {
        return context.json({ error: "unauthorised" }, 401);
      }

      const { languages } = await languagesService.read(account.id);

      return context.json({
        matchedCount: countMatchingPostings(db, context.req.valid("json"), languages),
      });
    },
  );

  routes.get("/profile/skip-companies", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    return context.json({ companies: await skipCompanyService.list(account.id) });
  });

  routes.put(
    "/profile/skip-companies",
    zValidator("json", skipCompaniesInputSchema),
    async (context) => {
      const account = await sessionUser(auth, context.req.raw);

      if (account === null) {
        return context.json({ error: "unauthorised" }, 401);
      }

      return context.json({
        companies: await skipCompanyService.replaceUserCompanies(
          account.id,
          context.req.valid("json"),
        ),
      });
    },
  );

  return routes;
}

async function sessionUser(auth: Auth, raw: Request) {
  const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

  return result?.user ?? null;
}
