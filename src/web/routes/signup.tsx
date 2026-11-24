import { useEffect, useState } from "react";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import { SignInCard } from "../components/signin-card.tsx";
import { SignInLayout } from "../components/signin-layout.tsx";
import { CARD_CLASS, CARD_DESCRIPTION } from "../components/signin-styles.ts";
import { WaitlistCard } from "../components/waitlist-card.tsx";
import { Card } from "../components/ui/card.tsx";

const meSchema = z.object({ publicSignupEnabled: z.boolean() });

/**
 * `/signup` opens the real sign-up flow while public sign-up is on, and the waitlist form while it is closed
 * (WS-22). The choice comes from `GET /api/me`, the same source the sign-in card already reads.
 * @returns The sign-up page for the current public-sign-up setting.
 */
export function SignUpPage() {
  const [publicSignup, setPublicSignup] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    const load = async () => {
      let open = false;

      try {
        const response = await fetch("/api/me", { signal: controller.signal });

        if (response.ok) {
          const parsed = meSchema.safeParse(await response.json());

          open = parsed.success && parsed.data.publicSignupEnabled;
        }
      } catch {
        open = false;
      }

      if (alive) {
        setPublicSignup(open);
      }
    };

    void load();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  let content = (
    <Card ariaLabelledBy="signup-loading" className={CARD_CLASS} variant="elevated">
      <p className={CARD_DESCRIPTION} id="signup-loading">
        {copy.waitlist.loading}
      </p>
    </Card>
  );

  if (publicSignup === true) {
    content = <SignInCard mode="signup" />;
  } else if (publicSignup === false) {
    content = <WaitlistCard />;
  }

  return <SignInLayout mode="signup">{content}</SignInLayout>;
}
