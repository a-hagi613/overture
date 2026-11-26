import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import { isDemoEmail } from "../../shared/demo.ts";
import { turnstileActionHeader, turnstileTokenHeader } from "../../shared/turnstile.ts";
import { BusyIndicator } from "./busy-indicator.tsx";
import { GoogleMark } from "./google-mark.tsx";
import { LinkedinMark } from "./linkedin-mark.tsx";
import { SignInForm } from "./signin-form.tsx";
import {
  ALERT_CLASS,
  CARD_CLASS,
  CARD_DESCRIPTION,
  CARD_HEADING,
  SWITCH_CLASS,
} from "./signin-styles.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Separator } from "./ui/separator.tsx";
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
  adminOwnerEmail: z.string().nullable().default(null),
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

  return onboarding?.needsOnboarding === true ? "/onboarding" : "/home";
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

export function SignInCard({ mode = "signin" }: { mode?: "signin" | "signup" }) {
  const isSignUp = mode === "signup";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const [adminOwnerEmail, setAdminOwnerEmail] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [verifying, setVerifying] = useState(false);
  const pendingRef = useRef(false);
  const siteKey = turnstileConfig === undefined ? undefined : turnstileConfig.siteKey;

  const {
    containerRef: socialContainer,
    hasToken: hasSocialToken,
    obtainToken: obtainSocialToken,
    prewarm: prewarmSocial,
  } = useTurnstile(
    socialProviders.length > 0 ? siteKey : null,
    "signin",
    turnstileConfig?.scriptUrl,
  );

  const {
    containerRef: magicContainer,
    hasToken: hasMagicToken,
    obtainToken: obtainMagicToken,
    prewarm: prewarmMagic,
  } = useTurnstile(siteKey, "magiclink", turnstileConfig?.scriptUrl);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    const load = async () => {
      let key: string | null = null;
      let scriptUrl: string | undefined;

      try {
        const response = await fetch("/api/me", { signal: controller.signal });

        if (response.ok) {
          const parsed = meSchema.parse(await response.json());

          key = parsed.turnstileSiteKey ?? null;
          scriptUrl = parsed.turnstileScriptUrl;

          if (alive) {
            setSocialProviders(parsed.socialProviders);
            setAdminOwnerEmail(parsed.adminOwnerEmail);
          }
        }
      } catch {
        key = null;
      }

      if (alive) {
        setTurnstileConfig({ scriptUrl, siteKey: key });
      }
    };

    void load();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (siteKey === undefined || siteKey === null) {
      return;
    }

    const warm = async () => {
      await prewarmMagic();

      if (socialProviders.length > 0) {
        await prewarmSocial();
      }
    };

    void warm();
  }, [prewarmMagic, prewarmSocial, siteKey, socialProviders.length]);

  useEffect(() => {
    if (phase !== "form") {
      return;
    }

    const check = async () => {
      const { data } = await authClient.getSession();

      if (data !== null) {
        queryClient.clear();
        void navigate(await nextAfterSignIn(), { replace: true });
      }
    };

    void check();
  }, [navigate, phase, queryClient]);

  const confirmToken = async (
    hasToken: () => boolean,
    obtainToken: () => Promise<TurnstileTokenResult>,
  ) => {
    if (!hasToken()) {
      setVerifying(true);
    }

    const result = await obtainToken();

    setVerifying(false);

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
      const token = await confirmToken(hasSocialToken, obtainSocialToken);

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

      if (result?.error === null) {
        queryClient.clear();

        return;
      }

      if (result !== null) {
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
    const token = await confirmToken(hasMagicToken, obtainMagicToken);

    if (token === null) {
      return;
    }

    const trimmed = email.trim();
    const headers = { [turnstileTokenHeader]: token, [turnstileActionHeader]: "magiclink" };

    if (adminOwnerEmail === null && isDemoEmail(trimmed)) {
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
        queryClient.clear();
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
        email: trimmed,
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
      queryClient.clear();
      setEmail(trimmed);
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
          <Button
            ariaBusy={pending === "google"}
            className="w-full"
            disabled={pending !== null}
            onClick={() => {
              void onSocial("google");
            }}
            variant="secondary"
          >
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-pdf ring-1 ring-border">
              <GoogleMark />
            </span>
            {isSignUp ? copy.signIn.signUpGoogle : copy.signIn.google}
          </Button>
        ) : null}
        {socialProviders.includes("linkedin") ? (
          <Button
            ariaBusy={pending === "linkedin"}
            className="w-full"
            disabled={pending !== null}
            onClick={() => {
              void onSocial("linkedin");
            }}
            variant="secondary"
          >
            <span className="flex h-6 w-6 flex-none items-center justify-center">
              <LinkedinMark />
            </span>
            {isSignUp ? copy.signIn.signUpLinkedin : copy.signIn.linkedin}
          </Button>
        ) : null}
      </>
    );

  if (phase === "suspended") {
    return (
      <>
        <Card ariaLabelledBy="signin-heading" className={CARD_CLASS} variant="elevated">
          <div className="mb-6 flex flex-col gap-1.5">
            <h1 className={CARD_HEADING} id="signin-heading">
              {copy.signIn.suspendedTitle}
            </h1>
            <p className={CARD_DESCRIPTION}>{copy.signIn.suspendedDescription}</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className={ALERT_CLASS} role="alert">
              <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none" />
              <div>
                <strong className="block text-sm font-bold">{copy.signIn.suspendedHeading}</strong>
                <p className="mt-1 text-foreground">{copy.signIn.suspendedBody}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-foreground">{copy.signIn.suspendedHelp}</p>
            <Button asChild className="w-full" variant="secondary">
              <a href="mailto:admin@tryoverture.com">{copy.signIn.suspendedEmail}</a>
            </Button>
          </div>
        </Card>
        <p className={SWITCH_CLASS}>
          <Button
            onClick={() => {
              setPhase("form");
              setActionError(null);
            }}
            variant="link"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {copy.signIn.back}
          </Button>
        </p>
      </>
    );
  }

  if (phase === "magic-sent") {
    const busyResend = pending === "magic";

    return (
      <Card ariaLabelledBy="signin-heading" className={CARD_CLASS} variant="elevated">
        <div className="mb-6 flex flex-col gap-1.5">
          <h1 className={CARD_HEADING} id="signin-heading">
            {copy.signIn.sentTitle}
          </h1>
          <p className={CARD_DESCRIPTION}>{copy.signIn.sentDescription}</p>
        </div>
        <div className="flex flex-col gap-3.5">
          <output className="rounded-lg bg-ok-soft px-4 py-4 text-sm leading-relaxed text-ok">
            <p className="font-semibold text-foreground">
              {copy.signIn.sentHeading} <span className="break-all font-mono text-xs">{email}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{copy.signIn.sentDetail}</p>
          </output>
          <Button
            ariaBusy={busyResend || verifying}
            className="w-full"
            disabled={pending !== null}
            onClick={() => {
              void onMagic();
            }}
            variant="secondary"
          >
            {busyResend ? <BusyIndicator /> : null}
            {verifying ? copy.signIn.verifying : copy.signIn.resend}
          </Button>
          <p className="text-center text-sm text-muted-foreground">{copy.signIn.resendHint}</p>
          <Button
            className="w-full"
            disabled={pending !== null}
            onClick={() => {
              setPhase("form");
              setEmail("");
              setActionError(null);
            }}
            variant="ghost"
          >
            {copy.signIn.changeEmail}
          </Button>
        </div>
        <div className="mt-3 grid min-h-[65px] w-full place-items-center">
          <div
            className="col-start-1 row-start-1 flex w-full justify-center"
            data-turnstile="social"
            ref={socialContainer}
          />
          <div
            className="col-start-1 row-start-1 flex w-full justify-center"
            data-turnstile="magic"
            ref={magicContainer}
          />
        </div>
        {actionError === null ? null : (
          <p className="mt-3 text-center text-xs font-semibold text-need" role="alert">
            {actionError}
          </p>
        )}
      </Card>
    );
  }

  const isRefused = phase === "refused";
  const cardHeading = isSignUp ? copy.signIn.signUpTitle : copy.signIn.title;
  const cardDesc = isSignUp ? copy.signIn.signUpDescription : copy.signIn.description;

  return (
    <>
      <Card ariaLabelledBy="signin-heading" className={CARD_CLASS} variant="elevated">
        <div className="mb-6 flex flex-col gap-1.5">
          {adminOwnerEmail === null ? null : (
            <div className="mb-1 flex flex-col gap-1">
              <p className={dsEyebrow}>{copy.signIn.adminPortalKicker}</p>
              <p className="break-words text-sm font-medium leading-relaxed text-foreground">
                {copy.signIn.adminPortalSignIn(adminOwnerEmail)}
              </p>
            </div>
          )}
          <h1 className={CARD_HEADING} id="signin-heading">
            {cardHeading}
          </h1>
          <p className={CARD_DESCRIPTION}>
            {isRefused ? copy.signIn.refusedDescription : cardDesc}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {isRefused ? (
            <div className={ALERT_CLASS} role="alert">
              <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none" />
              <div>
                <strong className="block text-sm font-bold">{copy.signIn.refusedHeading}</strong>
                <p className="mt-1 text-foreground">{copy.signIn.refusedBody}</p>
              </div>
            </div>
          ) : null}
          {socialButtons}
          {socialProviders.length === 0 ? null : (
            <div
              aria-hidden="true"
              className="my-4 flex items-center gap-3 text-xs text-muted-foreground"
            >
              <Separator className="flex-1" />
              <span>{isRefused ? copy.signIn.refusedLegend : copy.signIn.magicLegend}</span>
              <Separator className="flex-1" />
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
            primary
            refused={isRefused}
            submitLabel={isSignUp ? copy.signIn.signUpMagicSubmit : copy.signIn.magicSubmit}
            verifying={verifying}
          />
          {isRefused ? null : (
            <p className="mt-1 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Lock aria-hidden="true" className="h-3.5 w-3.5 flex-none" />
              <span className="font-medium text-muted-foreground">{copy.signIn.allowHeading}</span>
            </p>
          )}
        </div>
        <div className="mt-3 grid min-h-[65px] w-full place-items-center">
          <div
            className="col-start-1 row-start-1 flex w-full justify-center"
            data-turnstile="social"
            ref={socialContainer}
          />
          <div
            className="col-start-1 row-start-1 flex w-full justify-center"
            data-turnstile="magic"
            ref={magicContainer}
          />
        </div>
        {actionError === null ? null : (
          <p className="mt-3 text-center text-xs font-semibold text-need" role="alert">
            {actionError}
          </p>
        )}
      </Card>
      <p className={SWITCH_CLASS}>
        {isSignUp ? copy.signIn.switchToSignInPrompt : copy.signIn.switchToSignUpPrompt}{" "}
        <Link
          className="font-semibold text-foreground underline decoration-input underline-offset-4 transition hover:decoration-foreground"
          to={isSignUp ? "/signin" : "/signup"}
        >
          {isSignUp ? copy.signIn.switchToSignInAction : copy.signIn.switchToSignUpAction}
        </Link>
      </p>
    </>
  );
}
