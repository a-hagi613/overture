import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { ConsentState } from "../../shared/consent.ts";

import { consentStateSchema, consentVersionSchema } from "../../shared/consent.ts";

const versionsSchema = consentVersionSchema.array();

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`The consent request did not go through (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return body;
}

export async function fetchConsent() {
  return consentStateSchema.parse(await jsonFrom(await fetch("/api/consent")));
}

export async function fetchConsentVersions() {
  const body = z
    .object({ versions: versionsSchema })
    .parse(await jsonFrom(await fetch("/api/consent/versions")));

  return body.versions;
}

export async function acceptConsent(version: string) {
  return consentStateSchema.parse(
    await jsonFrom(
      await fetch("/api/consent/accept", {
        body: JSON.stringify({ version }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ),
  );
}

export const consentKey = ["consent"] as const;
export const consentVersionsKey = ["consent-versions"] as const;

export function useConsent() {
  return useQuery({ queryFn: fetchConsent, queryKey: consentKey });
}

export function useConsentVersions(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: fetchConsentVersions,
    queryKey: consentVersionsKey,
  });
}

export function useAcceptConsent() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: acceptConsent,
    onSuccess: (state: ConsentState) => {
      client.setQueryData(consentKey, state);
      void client.invalidateQueries({ queryKey: consentVersionsKey });
    },
  });
}
