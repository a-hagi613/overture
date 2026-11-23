import { z } from "zod";

/** The kinds of question a support request may be about (Admin Portal Support Queue). */
export const SUPPORT_CATEGORIES = ["account", "billing", "bug", "other"] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** The Support Queue states a ticket moves through. New tickets start open. */
export const SUPPORT_TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

/**
 * What the support form sends. One subject line, one message, and the kind of
 * question; the sender's address comes from the session, never the body.
 */
export const supportRequestSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES).default("other"),
  message: z.string().trim().min(1).max(5000),
  subject: z.string().trim().min(1).max(200),
});

export type SupportRequest = z.infer<typeof supportRequestSchema>;
