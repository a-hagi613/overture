import { z } from "zod";

/** The kinds of question a support request may be about (Admin Portal Support Queue). */
export const SUPPORT_CATEGORIES = ["account", "billing", "bug", "other"] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** The Support Queue states a ticket moves through. New tickets start open. */
export const SUPPORT_TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

/** The Support Queue filters: every state, plus the unfiltered queue. */
export const SUPPORT_STATUS_FILTERS = ["open", "in_progress", "resolved", "closed", "all"] as const;

export type SupportStatusFilter = (typeof SUPPORT_STATUS_FILTERS)[number];

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

export const supportResponseSchema = z.object({
  ok: z.literal(true),
  referenceId: z.string(),
});

export type SupportResponse = z.infer<typeof supportResponseSchema>;

/**
 * The Admin Portal's triage write: the ticket's new state and the owner's
 * internal note. The note is trimmed, so an empty note clears it.
 */
export const supportTicketUpdateSchema = z.object({
  adminNotes: z.string().trim().max(5000).optional(),
  status: z.enum(SUPPORT_TICKET_STATUSES),
});

export type SupportTicketUpdate = z.infer<typeof supportTicketUpdateSchema>;

/** The Admin Portal's reply: one message to the ticket's author. */
export const supportReplySchema = z.object({
  message: z.string().trim().min(1).max(5000),
});

export type SupportReply = z.infer<typeof supportReplySchema>;
