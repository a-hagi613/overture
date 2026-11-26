import type { InboundMailEnv } from "./env.ts";

export const DEFAULT_ALIAS_EMAIL_DOMAIN = "tryoverture.com";

export const RESERVED_ALIAS_LOCAL_PARTS = new Set([
  "abuse",
  "admin",
  "alerts",
  "apply",
  "billing",
  "careers",
  "hello",
  "help",
  "hostmaster",
  "info",
  "jobs",
  "legal",
  "mailer-daemon",
  "no-reply",
  "noreply",
  "notify",
  "postmaster",
  "privacy",
  "root",
  "security",
  "support",
  "webmaster",
]);

const ALIAS_LOCAL_PART = /^[a-z0-9][a-z0-9._+-]{1,62}[a-z0-9]$/u;

export function aliasEmailDomain(env: InboundMailEnv) {
  const configured = env.ALIAS_EMAIL_DOMAIN?.trim().toLowerCase() ?? "";

  return configured === "" ? DEFAULT_ALIAS_EMAIL_DOMAIN : configured;
}

export function addressParts(address: string) {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");

  if (at <= 0 || at === trimmed.length - 1) {
    return null;
  }

  return { local: trimmed.slice(0, at), domain: trimmed.slice(at + 1) };
}

export function isAliasRecipient(address: string, domain: string) {
  const parts = addressParts(address);

  if (parts === null || parts.domain !== domain) {
    return false;
  }

  if (parts.local.startsWith("in-") || RESERVED_ALIAS_LOCAL_PARTS.has(parts.local)) {
    return false;
  }

  return ALIAS_LOCAL_PART.test(parts.local);
}
