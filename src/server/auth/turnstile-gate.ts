import { z } from "zod";

import type { TurnstileAction } from "../../shared/turnstile.ts";

import { copy } from "../../shared/copy.ts";
import {
  turnstileActionHeader,
  turnstileActionSchema,
  turnstileTokenHeader,
  turnstileTokenMaxLength,
} from "../../shared/turnstile.ts";
import { env, turnstileHostnames } from "../config/env.ts";
import { clientIp } from "./client-ip.ts";

export const turnstileSiteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const siteverifyTimeoutMs = 10_000;

const gatedEndpoints = new Map<string, readonly TurnstileAction[]>([
  ["/api/auth/sign-in/social", ["signin"]],
  ["/api/auth/sign-in/magic-link", ["magiclink"]],
  ["/api/auth/demo/sign-in", ["magiclink"]],
]);

const tokenSchema = z.string().min(1).max(turnstileTokenMaxLength);

const siteverifySchema = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

function refuse() {
  return Response.json(
    { code: "captcha_failed", message: copy.signIn.captchaFailed },
    { status: 403 },
  );
}

export async function verifyTurnstile(request: Request) {
  const allowed = gatedEndpoints.get(new URL(request.url).pathname);

  if (allowed === undefined) {
    return null;
  }

  const token = tokenSchema.safeParse(request.headers.get(turnstileTokenHeader));
  const declared = turnstileActionSchema.safeParse(request.headers.get(turnstileActionHeader));

  if (!token.success || !declared.success || !allowed.includes(declared.data)) {
    return refuse();
  }

  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token.data });
  const remoteip = clientIp(request, { flyAppName: env.FLY_APP_NAME, nodeEnv: env.NODE_ENV });

  if (remoteip !== null) {
    form.set("remoteip", remoteip);
  }

  const verdict = await fetch(turnstileSiteverifyUrl, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(siteverifyTimeoutMs),
  }).catch(() => null);

  if (verdict === null || !verdict.ok) {
    return refuse();
  }

  const body = siteverifySchema.safeParse(await verdict.json().catch(() => null));

  if (
    !body.success ||
    !body.data.success ||
    body.data.action !== declared.data ||
    body.data.hostname === undefined ||
    !turnstileHostnames.includes(body.data.hostname)
  ) {
    return refuse();
  }

  return null;
}
