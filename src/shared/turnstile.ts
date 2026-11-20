import { z } from "zod";

export const turnstileActionSchema = z.enum(["signin", "signup", "magiclink"]);

export type TurnstileAction = z.infer<typeof turnstileActionSchema>;

export const turnstileTokenHeader = "x-captcha-response";

export const turnstileActionHeader = "x-turnstile-action";

export const turnstileTokenMaxLength = 2048;
