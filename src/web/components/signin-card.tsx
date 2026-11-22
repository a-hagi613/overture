import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import { isDemoEmail } from "../../shared/demo.ts";
import { turnstileActionHeader, turnstileTokenHeader } from "../../shared/turnstile.ts";
import { BusyIndicator } from "./busy-indicator.tsx";
import { GoogleMark } from "./google-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { SignInForm } from "./signin-form.tsx";
import {
  ALERT_CLASS,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_CLASS,
  CARD_DESCRIPTION,
  CARD_HEADING,
  SWITCH_CLASS,
} from "./signin-styles.ts";
import { authClient } from "../lib/auth-client.ts";
import { fetchOnboardingState } from "../lib/onboarding-api.ts";
import { useTurnstile, turnstileFailureMessage } from "../lib/turnstile.ts";
import type { TurnstileTokenResult } from "../lib/turnstile.ts";

type SocialProvider = "google" | "linkedin";

type Pending = "google" | "linkedin" | "magic";

type Phase = "form" | "magic-sent" | "refused" | "suspended";

interface TurnstileCardConfig {
  scriptUrl: string | undefined;
  siteKey: string | null;
}

const CALLBACK_URL = "/signin";

const meSchema = z.object({
  user: z.unknown().nullable(),
  turnstileSiteKey: z.string().optional(),
  turnstileScriptUrl: z.string().optional(),
  socialProviders: z.array(z.enum(["google", "linkedin"])).default([]),
});

const authErrorSchema = z.object({ code: z.string().optional() });

const callbackPhase = new Map<string, Phase>([
  ["forbidden", "refused"],
  ["account_suspended", "suspended"],
]);

async function nextAfterSignIn() {
  const onboarding = await fetchOnboardingState().catch(() => null);

  return onboarding?.needsOnboarding === true ? "/onboarding" : "/";
}

function callbackMessage(code: string) {
  if (
    code === "email_not_verified" ||
    code === "EMAIL_NOT_VERIFIED" ||
    code === "OAUTH_LINK_ERROR" ||
    code === "account_not_linked"
  ) {
    return copy.signIn.emailNotVerified;
  }

  if (code === "rate_limited") {
    return copy.signIn.rateLimited;
  }

  if (code === "captcha_failed") {
    return copy.signIn.captchaFailed;
  }

  return null;
}

function presentError(status: number, code: string | undefined) {
  if (status === 403) {
    if (code === "captcha_failed") {
      return copy.signIn.captchaFailed;
    }

    if (code === "account_suspended") {
      return copy.signIn.accountSuspended;
    }

    return copy.signIn.refusedEmail;
  }

  if (status === 429) {
    return copy.signIn.rateLimited;
  }

  return copy.signIn.genericError;
}

export function SignInCard() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const callbackError = search.get("error") ?? "";
  const phaseFromCallback = callbackPhase.get(callbackError);
  const [phase, setPhase] = useState<Phase>(phaseFromCallback ?? "form");
  const [email, setEmail] = useState("");
  const [actionError, setActionError] = useState<string | null>(callbackMessage(callbackError));

  const [turnstileConfig, setTurnstileConfig] = useState<TurnstileCardConfig | undefined>(
    undefined,
  );

  const [socialProviders, setSocialProviders] = useState<SocialProvider[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef(false);
  const siteKey = turnstileConfig === undefined ? undefined : turnstileConfig.siteKey;

  const { containerRef: socialContainer, obtainToken: obtainSocialToken } = useTurnstile(
    socialProviders.length > 0 ? siteKey : null,
    "signin",
    turnstileConfig?.scriptUrl,
  );

  const { containerRef: magicContainer, obtainToken: obtainMagicToken } = useTurnstile(
    siteKey,
    "magiclink",
    turnstileConfig?.scriptUrl,
  );

  useEffect(() => {
    const load = async () => {
      let key: string | null = null;
      let scriptUrl: string | undefined;

      try {
        const response = await fetch("/api/me", { signal: AbortSignal.timeout(10_000) });

        if (response.ok) {
          const parsed = meSchema.parse(await response.json());

          key = parsed.turnstileSiteKey ?? null;
          scriptUrl = parsed.turnstileScriptUrl;
          setSocialProviders(parsed.socialProviders);
        }
      } catch {
        key = null;
      }

      setTurnstileConfig({ scriptUrl, siteKey: key });
    };

    void load();
  }, []);

  useEffect(() => {
    if (phase !== "form") {
      return;
    }

    const check = async () => {
      const { data } = await authClient.getSession();

      if (data !== null) {
        void navigate(await nextAfterSignIn(), { replace: true });
      }
    };

    void check();
  }, [navigate, phase]);

  const confirmToken = async (obtainToken: () => Promise<TurnstileTokenResult>) => {
    const result = await obtainToken();

    if (result.token === null) {
      setActionError(turnstileFailureMessage(result.failure));

      return null;
    }

    return result.token;
  };

  const runPending = async (kind: Pending, task: () => Promise<void>) => {
    if (pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(kind);
    setActionError(null);

    try {
      await task();
    } catch {
      setActionError(copy.signIn.genericError);
    }

    pendingRef.current = false;
    setPending(null);
  };

  const onSocial = async (provider: SocialProvider) => {
    await runPending(provider, async () => {
      const token = await confirmToken(obtainSocialToken);

      if (token === null) {
        return;
      }

      const result = await authClient.signIn
        .social({
          provider,
          callbackURL: CALLBACK_URL,
          errorCallbackURL: CALLBACK_URL,
          fetchOptions: {
            headers: { [turnstileTokenHeader]: token, [turnstileActionHeader]: "signin" },
          },
        })
        .catch(() => null);

      if (result !== null && result.error !== null) {
        const next = presentError(result.error.status, result.error.code);

        if (result.error.code === "forbidden") {
          setPhase("refused");
          setActionError(null);
        } else if (
          result.error.code === "email_not_verified" ||
          result.error.code === "account_not_linked"
        ) {
          setActionError(copy.signIn.emailNotVerified);
        } else if (result.error.code === "account_suspended") {
          setPhase("suspended");
        } else {
          setActionError(next);
        }
      }
    });
  };

  const submitMagic = async () => {
    const token = await confirmToken(obtainMagicToken);

    if (token === null) {
      return;
    }

    const trimmed = email.trim();
    const headers = { [turnstileTokenHeader]: token, [turnstileActionHeader]: "magiclink" };

    if (isDemoEmail(trimmed)) {
      const response = await fetch("/api/auth/demo/sign-in", {
        body: JSON.stringify({ email: trimmed }),
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      }).catch(() => null);

      if (response === null) {
        setActionError(copy.signIn.genericError);

        return;
      }

      if (response.ok) {
        void navigate(await nextAfterSignIn(), { replace: true });

        return;
      }

      if (response.status !== 404) {
        const parsed = authErrorSchema.safeParse(await response.json().catch(() => null));
        const code = parsed.success ? parsed.data.code : undefined;

        if (code === "captcha_failed") {
          setActionError(copy.signIn.captchaFailed);
        } else if (response.status === 403) {
          setPhase("refused");
          setActionError(null);
        } else {
          setActionError(presentError(response.status, code));
        }

        return;
      }
    }

    const result = await authClient.signIn
      .magicLink({
        email,
        callbackURL: CALLBACK_URL,
        fetchOptions: {
          headers: { [turnstileTokenHeader]: token, [turnstileActionHeader]: "magiclink" },
        },
      })
      .catch(() => null);

    if (result === null) {
      setActionError(copy.signIn.genericError);

      return;
    }

    if (result.error === null) {
      setPhase("magic-sent");
      setActionError(null);

      return;
    }

    if (result.error.code === "forbidden") {
      setPhase("refused");
      setActionError(null);
    } else if (result.error.code === "account_suspended") {
      setPhase("suspended");
    } else {
      setActionError(presentError(result.error.status, result.error.code));
    }
  };

  const onMagic = async () => {
    await runPending("magic", submitMagic);
  };

  const socialButtons =
    socialProviders.length === 0 ? null : (
      <>
        {socialProviders.includes("google") ? (
          <button
            aria-busy={pending === "google" || undefined}
            className={phase === "refused" ? BTN_SECONDARY : BTN_PRIMARY}
            disabled={pending !== null}
            onClick={() => {
              void onSocial("google");
            }}
            type="button"
          >
            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-white shadow-[0_0_0_1px_rgba(21,19,17,0.08)]">
              <GoogleMark />
            </span>
            {copy.signIn.google}
          </button>
        ) : null}
        {socialProviders.includes("linkedin") ? (
          <button
            aria-busy={pending === "linkedin" || undefined}
            className={BTN_SECONDARY}
            disabled={pending !== null}
            onClick={() => {
              void onSocial("linkedin");
            }}
            type="button"
          >
            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded border border-input bg-muted text-[11px] font-bold">
              {copy.signIn.linkedinBadge}
            </span>
            {copy.signIn.linkedin}
          </button>
        ) : null}
      </>
    );

  if (phase === "suspended") {
    return (
      <>
        <section aria-labelledby="signin-heading" className={CARD_CLASS}>
          <div className="mb-[22px] flex flex-col gap-1.5">
            <h1 className={CARD_HEADING} id="signin-heading">
              {copy.signIn.suspendedTitle}
            </h1>
            <p className={CARD_DESCRIPTION}>{copy.signIn.suspendedDescription}</p>
          </div>
          <div className="flex flex-col gap-3">
            <div
              className={ALERT_CLASS}
              role="alert"
              style={{ background: "var(--color-need-soft)" }}
            >
              <span className="mt-0.5 flex-none">
                <NavGlyph name="lock" size={18} />
              </span>
              <div>
                <strong className="block text-[14.5px] font-bold">
                  {copy.signIn.suspendedHeading}
                </strong>
                <p className="mt-[3px] text-foreground">{copy.signIn.suspendedBody}</p>
              </div>
            </div>
            <p className="text-[13.5px] leading-normal text-foreground">
              {copy.signIn.suspendedHelp}
            </p>
            <a className={BTN_SECONDARY} href="mailto:admin@tryoverture.com">
              {copy.signIn.suspendedEmail}
            </a>
          </div>
        </section>
        <p className={SWITCH_CLASS}>
          <button
            className="inline-flex min-h-[44px] items-center gap-2 px-1 font-semibold text-foreground underline underline-offset-[3px]"
            onClick={() => {
              setPhase("form");
              setActionError(null);
            }}
            type="button"
          >
            <NavGlyph name="back" size={15} />
            {copy.signIn.back}
          </button>
        </p>
      </>
    );
  }

  if (phase === "magic-sent") {
    const busyResend = pending === "magic";

    return (
      <section aria-labelledby="signin-heading" className={CARD_CLASS}>
        <div className="mb-[22px] flex flex-col gap-1.5">
          <h1 className={CARD_HEADING} id="signin-heading">
            {copy.signIn.sentTitle}
          </h1>
          <p className={CARD_DESCRIPTION}>{copy.signIn.sentDescription}</p>
        </div>
        <div className="flex flex-col gap-3.5">
          <output
            className="rounded-lg px-4 py-[15px] text-[13.5px] leading-normal text-ok"
            style={{ background: "var(--color-ok-soft)" }}
          >
            <p className="font-semibold text-foreground">
              {copy.signIn.sentHeading}{" "}
              <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{email}</span>
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{copy.signIn.sentDetail}</p>
          </output>
          <button
            aria-busy={busyResend || undefined}
            className={BTN_SECONDARY}
            disabled={pending !== null}
            onClick={() => {
              void onMagic();
            }}
            type="button"
          >
            {busyResend ? <BusyIndicator /> : null}
            {copy.signIn.resend}
          </button>
          <p className="text-center text-[13.5px] text-muted-foreground">
            {copy.signIn.resendHint}
          </p>
          <button
            className={`${BTN_GHOST} disabled:cursor-not-allowed disabled:opacity-[.45]`}
            disabled={pending !== null}
            onClick={() => {
              setPhase("form");
              setEmail("");
              setActionError(null);
            }}
            type="button"
          >
            {copy.signIn.changeEmail}
          </button>
        </div>
        <div data-turnstile="social" ref={socialContainer} />
        <div data-turnstile="magic" ref={magicContainer} />
      </section>
    );
  }

  const isRefused = phase === "refused";

  return (
    <section aria-labelledby="signin-heading" className={CARD_CLASS}>
      <div className="mb-[22px] flex flex-col gap-1.5">
        <h1 className={CARD_HEADING} id="signin-heading">
          {copy.signIn.title}
        </h1>
        <p className={CARD_DESCRIPTION}>
          {isRefused ? copy.signIn.refusedDescription : copy.signIn.description}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {isRefused ? (
          <div
            className={ALERT_CLASS}
            role="alert"
            style={{ background: "var(--color-need-soft)" }}
          >
            <span className="mt-0.5 flex-none">
              <NavGlyph name="lock" size={18} />
            </span>
            <div>
              <strong className="block text-[14.5px] font-bold">
                {copy.signIn.refusedHeading}
              </strong>
              <p className="mt-[3px] text-foreground">{copy.signIn.refusedBody}</p>
            </div>
          </div>
        ) : null}
        {socialButtons}
        {socialProviders.length === 0 ? null : (
          <div
            aria-hidden="true"
            className="my-[18px] flex items-center gap-3 text-xs leading-[18px] text-muted-foreground"
          >
            <hr className="flex-1 border-border" />
            <span>{isRefused ? copy.signIn.refusedLegend : copy.signIn.magicLegend}</span>
            <hr className="flex-1 border-border" />
          </div>
        )}
        <SignInForm
          busy={pending === "magic"}
          email={email}
          onEmail={setEmail}
          onSubmit={() => {
            void onMagic();
          }}
          pending={pending !== null}
          refused={isRefused}
        />
        {isRefused ? null : (
          <p className="flex items-start gap-[9px] text-pretty text-[12.5px] leading-[1.52] text-muted-foreground">
            <span className="mt-0.5 flex-none">
              <NavGlyph name="lock" size={14} />
            </span>
            <span>
              <span className="font-semibold text-foreground">{copy.signIn.allowHeading}</span>{" "}
              {copy.signIn.allowNote}
            </span>
          </p>
        )}
      </div>
      <div data-turnstile="social" ref={socialContainer} />
      <div data-turnstile="magic" ref={magicContainer} />
      {actionError === null ? null : (
        <p className="mt-3 text-center text-[13px] font-semibold text-need" role="alert">
          {actionError}
        </p>
      )}
    </section>
  );
}
