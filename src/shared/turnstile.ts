import { z } from "zod";

export const turnstileActionSchema = z.enum(["signin", "signup", "magiclink", "reset"]);

export type TurnstileAction = z.infer<typeof turnstileActionSchema>;

export const turnstileScriptUrl =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const turnstileTokenHeader = "x-captcha-response";

export const turnstileActionHeader = "x-turnstile-action";

export const turnstileTokenMaxLength = 2048;
