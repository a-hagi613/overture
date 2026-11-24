import { z } from "zod";

/**
 * The three states one waitlist entry moves through (WS-22): someone asked for an invite (`pending`), an admin sent
 * one (`invited`), and that email signed up (`joined`). Nothing goes backwards.
 */
export const WAITLIST_STATUSES = ["pending", "invited", "joined"] as const;

export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const WAITLIST_FILTERS = ["all", ...WAITLIST_STATUSES] as const;

export type WaitlistFilter = (typeof WAITLIST_FILTERS)[number];

export const WAITLIST_ORDERS = ["newest", "oldest"] as const;

export type WaitlistOrder = (typeof WAITLIST_ORDERS)[number];

/** The names of the invisible honeypot fields a bot fills but a person never sees. */
export const WAITLIST_HONEYPOT_FIELDS = ["website", "company_url"] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional();

/**
 * The body the public form sends. The two honeypot fields are optional so a real browser leaves them empty and a bot
 * that autofills every input reveals itself without a CAPTCHA.
 */
export const waitlistSubmitSchema = z.object({
  email: z.email(),
  targetRole: optionalText(120),
  targetLocation: optionalText(120),
  website: optionalText(200),
  company_url: optionalText(200),
});

export type WaitlistSubmit = z.infer<typeof waitlistSubmitSchema>;

export const waitlistConfirmation = {
  ok: true as const,
  message: "You're on the list. We'll write when your invite is ready.",
};

export const waitlistRateLimited = {
  ok: false as const,
  error: "rate_limited" as const,
  message: "Too many tries from this connection. Please try again in an hour.",
};

export const waitlistEntrySchema = z.object({
  createdAt: z.number(),
  email: z.string(),
  id: z.string(),
  invitedAt: z.number().nullable(),
  status: z.enum(WAITLIST_STATUSES),
  targetLocation: z.string().nullable(),
  targetRole: z.string().nullable(),
  updatedAt: z.number(),
});

export type WaitlistEntryView = z.infer<typeof waitlistEntrySchema>;

export const waitlistCountsSchema = z.object({
  all: z.number(),
  invited: z.number(),
  joined: z.number(),
  pending: z.number(),
});

export const waitlistResponseSchema = z.object({
  counts: waitlistCountsSchema,
  entries: z.array(waitlistEntrySchema),
  total: z.number(),
});

export const waitlistInviteResponseSchema = z.object({
  emailed: z.boolean(),
  entry: waitlistEntrySchema,
});
