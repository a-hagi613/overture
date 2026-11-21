import { z } from "zod";

export const INITIAL_CONSENT_VERSION = "1";

export const consentAcceptInputSchema = z.object({
  version: z.string().trim().min(1).max(20),
});

export const consentVersionSchema = z.object({
  publishedAt: z.string(),
  text: z.string(),
  version: z.string(),
});

export const consentStateSchema = z.object({
  accepted: z
    .object({
      at: z.string(),
      version: z.string(),
    })
    .nullable(),
  current: consentVersionSchema,
});

export type ConsentAcceptInput = z.infer<typeof consentAcceptInputSchema>;

export type ConsentState = z.infer<typeof consentStateSchema>;

export type ConsentVersion = z.infer<typeof consentVersionSchema>;
