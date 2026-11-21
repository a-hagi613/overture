import type { Clock } from "../platform/ports/clock.ts";
import type { EmailSendingConfig, EmailSendingReadiness } from "../platform/mail/sending-domain.ts";
import type { LiveCheckResult } from "./types.ts";

import { readEmailSendingReadiness } from "../platform/mail/sending-domain.ts";

const GATED_REASON =
  "REQUIRE_EMAIL_SENDING is not set; M2 owner setup #236 turns the sending-domain guard on";

export interface EmailSendingGuard {
  required: boolean;
  config: EmailSendingConfig | null;
}

function recordOk(readiness: EmailSendingReadiness, kind: "mx" | "spf" | "dkim" | "dmarc") {
  return readiness.records.find((record) => record.kind === kind)?.ok ?? false;
}

function readinessDetail(readiness: EmailSendingReadiness) {
  return {
    status: readiness.ready ? "ready" : "not-ready",
    plan: readiness.plan,
    domain: readiness.domain,
    onboarded: readiness.onboarded,
    enabled: readiness.enabled,
    returnPathDomain: readiness.returnPathDomain,
    dkimSelector: readiness.dkimSelector,
    mx: recordOk(readiness, "mx"),
    spf: recordOk(readiness, "spf"),
    dkim: recordOk(readiness, "dkim"),
    dmarc: recordOk(readiness, "dmarc"),
    error: readiness.error,
  };
}

export async function runEmailSendingGuard(guard: EmailSendingGuard, clock: Clock) {
  const startedAt = clock.now();

  if (!guard.required) {
    const gated: LiveCheckResult = {
      check: "mail.sending",
      ok: true,
      startedAt,
      durationMs: 0,
      detail: { status: "gated", reason: GATED_REASON, plan: "unknown", error: null },
    };

    return gated;
  }

  if (guard.config === null) {
    const missing: LiveCheckResult = {
      check: "mail.sending",
      ok: false,
      startedAt,
      durationMs: 0,
      detail: {
        status: "not-configured",
        error:
          "REQUIRE_EMAIL_SENDING is set, but CLOUDFLARE_EMAIL_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ZONE_ID are not all set.",
      },
    };

    return missing;
  }

  const readiness = await readEmailSendingReadiness(guard.config);

  const result: LiveCheckResult = {
    check: "mail.sending",
    ok: readiness.ready,
    startedAt,
    durationMs: clock.now() - startedAt,
    detail: readinessDetail(readiness),
  };

  return result;
}
