import { validJson } from "./validators.ts";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import type { Clock } from "../platform/ports/clock.ts";

import { logInfo } from "../platform/log.ts";
import { createScoreLimiter } from "../lab/limit.ts";
import { labScript, labStylesheet } from "../lab/client.ts";
import {
  renderConfirmationPage,
  renderFormPage,
  renderHCaptchaPage,
  renderLabIndex,
  renderReCaptchaPage,
  renderTurnstilePage,
  LAB_FORM_ATS,
} from "../lab/pages.ts";
import type { LabChallengeMode, LabPageEnvironment } from "../lab/pages.ts";
import { scoreRecaptchaV3 } from "../lab/recaptcha.ts";

export const LAB_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://www.google.com https://www.gstatic.com https://js.hcaptcha.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://www.google.com https://hcaptcha.com",
  "frame-src https://www.google.com https://newassets.hcaptcha.com https://challenges.cloudflare.com",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export interface LabRouteDeps {
  clock: Clock;
  environment: LabPageEnvironment;
  recaptchaSecret: string | undefined;
  recaptchaVerifyUrl: string;
}

const scoreBody = z.object({ token: z.string().min(1).max(4096) });

const challengeMode = (value: string | undefined) =>
  (value === "blocked" ? "blocked" : "pass") satisfies LabChallengeMode;

const html = (body: string) =>
  new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": LAB_CONTENT_SECURITY_POLICY,
      "content-type": "text/html; charset=utf-8",
    },
  });

const script = (body: string) =>
  new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": LAB_CONTENT_SECURITY_POLICY,
      "content-type": "text/javascript; charset=utf-8",
    },
  });

const style = (body: string) =>
  new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": LAB_CONTENT_SECURITY_POLICY,
      "content-type": "text/css; charset=utf-8",
    },
  });

const SCORE_LIMIT = 30;
const SCORE_WINDOW_MS = 60_000;

const clientKey = (context: Context) =>
  context.req.header("cf-connecting-ip") ??
  context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
  "local";

export function createLabRoutes(deps: LabRouteDeps) {
  const routes = new Hono();

  const scoreLimiter = createScoreLimiter({
    limit: SCORE_LIMIT,
    now: () => deps.clock.now(),
    windowMs: SCORE_WINDOW_MS,
  });

  routes.get("/", () => html(renderLabIndex()));

  routes.get("/lab.css", () => style(labStylesheet));

  routes.get("/lab.js", () => script(labScript));

  routes.get("/recaptcha-v3", (context) =>
    html(renderReCaptchaPage(deps.environment, challengeMode(context.req.query("challenge")))),
  );

  routes.get("/hcaptcha", (context) =>
    html(renderHCaptchaPage(deps.environment, challengeMode(context.req.query("challenge")))),
  );

  routes.get("/turnstile", (context) =>
    html(renderTurnstilePage(deps.environment, challengeMode(context.req.query("challenge")))),
  );

  routes.get("/forms/:ats", (context) => {
    const ats = LAB_FORM_ATS.find((candidate: string) => candidate === context.req.param("ats"));

    if (ats === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    return html(renderFormPage(ats));
  });

  routes.post("/forms/:ats/submit", (context) => {
    const ats = LAB_FORM_ATS.find((candidate: string) => candidate === context.req.param("ats"));

    if (ats === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    return html(renderConfirmationPage(ats));
  });

  routes.post("/recaptcha/score", validJson(scoreBody), async (context) => {
    const origin = context.req.header("origin");

    if (origin !== undefined && origin !== new URL(context.req.url).origin) {
      return context.json({ reason: "cross_origin", score: null, success: false }, 403);
    }

    if (!scoreLimiter.allow(clientKey(context))) {
      return context.json({ reason: "rate_limited", score: null, success: false }, 429);
    }

    if (deps.recaptchaSecret === undefined) {
      return context.json({ reason: "not_configured", score: null, success: false }, 503);
    }

    const verdict = await scoreRecaptchaV3({
      action: "lab",
      secret: deps.recaptchaSecret,
      token: context.req.valid("json").token,
      verifyUrl: deps.recaptchaVerifyUrl,
    });

    if (verdict.success) {
      logInfo("lab.recaptcha.score", `score ${String(verdict.score)}`);
    }

    return context.json({
      reason: verdict.success ? null : verdict.reason,
      score: verdict.score,
      success: verdict.success,
    });
  });

  return routes;
}
