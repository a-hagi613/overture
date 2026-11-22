import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const billingSchema = z.object({
  applicationsLeft: z.number(),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.number().nullable(),
  customer: z.boolean(),
  enabled: z.boolean(),
  plan: z.enum(["week", "month"]).nullable(),
  planApplications: z.number(),
  status: z.string().nullable(),
});

export type BillingState = z.infer<typeof billingSchema>;

export type BillingPlan = "week" | "month";

async function loadBilling() {
  const response = await fetch("/api/billing");

  if (!response.ok) {
    throw new Error(`The billing request did not go through (${String(response.status)}).`);
  }

  return billingSchema.parse(await response.json());
}

export function useBilling(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["billing"],
    queryFn: loadBilling,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

const urlSchema = z.object({ url: z.url() });

async function postForUrl(path: string, init: RequestInit) {
  const response = await fetch(path, init);

  if (!response.ok) {
    throw new Error(`The billing request did not go through (${String(response.status)}).`);
  }

  return urlSchema.parse(await response.json()).url;
}

/**
 * Starts Stripe Checkout for a plan.
 * @param plan The plan the user chose.
 * @returns The Checkout page to send the user to.
 */
export async function startCheckout(plan: BillingPlan) {
  return postForUrl("/api/billing/checkout", {
    body: JSON.stringify({ plan }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

/**
 * Opens the Stripe customer portal, where plan switches, cancels and payment live.
 * @returns The portal page to send the user to.
 */
export async function openPortal() {
  return postForUrl("/api/billing/portal", { method: "POST" });
}
