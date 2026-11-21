import { z } from "zod";

const verdictSchema = z.object({
  success: z.boolean(),
  score: z.number().min(0).max(1).nullish(),
  action: z.string().nullish(),
});

export type RecaptchaVerdict =
  | { success: true; score: number }
  | { success: false; reason: "not_configured" | "refused" | "unreachable"; score: null };

export interface RecaptchaScoreInput {
  action: string;
  secret: string;
  token: string;
  verifyUrl: string;
}

export async function scoreRecaptchaV3(input: RecaptchaScoreInput) {
  let response: Response;

  try {
    response = await fetch(input.verifyUrl, {
      body: new URLSearchParams({ response: input.token, secret: input.secret }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { reason: "unreachable", score: null, success: false } satisfies RecaptchaVerdict;
  }

  if (!response.ok) {
    return { reason: "unreachable", score: null, success: false } satisfies RecaptchaVerdict;
  }

  const parsed = verdictSchema.safeParse(await response.json().catch(() => null));

  if (
    !parsed.success ||
    !parsed.data.success ||
    parsed.data.score === null ||
    parsed.data.score === undefined
  ) {
    return { reason: "refused", score: null, success: false };
  }

  if (
    parsed.data.action !== null &&
    parsed.data.action !== undefined &&
    parsed.data.action !== input.action
  ) {
    return { reason: "refused", score: null, success: false };
  }

  return { score: parsed.data.score, success: true } satisfies RecaptchaVerdict;
}
