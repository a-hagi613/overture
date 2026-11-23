import { z } from "zod";

export const supportCategorySchema = z.enum(["general", "billing", "applications", "bug"]);

export type SupportCategory = z.infer<typeof supportCategorySchema>;

export const supportRequestSchema = z.object({
  category: supportCategorySchema,
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(10).max(4000),
});

export type SupportRequest = z.infer<typeof supportRequestSchema>;

export const supportResponseSchema = z.object({
  ok: z.literal(true),
  referenceId: z.string(),
});

export type SupportResponse = z.infer<typeof supportResponseSchema>;
