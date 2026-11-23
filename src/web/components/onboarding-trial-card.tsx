import { ArrowLeft, CreditCard } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

const text = copy.onboarding.trial;

export type TrialCardState = "verify" | "declined" | "used";

export function OnboardingTrialCard({
  backTo = "/onboarding/forward",
  busy,
  error,
  onVerify,
  state,
}: {
  backTo?: string;
  busy: boolean;
  error: boolean;
  onVerify: () => void;
  state: TrialCardState;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state !== "verify") {
      headingRef.current?.focus();
    }
  }, [state]);

  let badgeVariant: "secondary" | "need" | "signal" = "secondary";
  let pillLabel: string = text.stepPill;
  let titleText: string = text.verifyTitle;
  let bodyText: string = text.intro;

  if (state === "declined") {
    badgeVariant = "need";
    pillLabel = text.declinedTitle;
    titleText = text.declinedTitle;
    bodyText = text.declinedBody;
  } else if (state === "used") {
    badgeVariant = "signal";
    pillLabel = text.usedTitle;
    titleText = text.usedHeading;
    bodyText = text.usedBody;
  }

  let actions = (
    <>
      <Button disabled={busy} onClick={onVerify} size="lg" variant="primary">
        <CreditCard aria-hidden="true" size={16} />
        <span>{busy ? text.verifying : text.verifyButton}</span>
      </Button>
      <Button asChild size="default" variant="ghost">
        <Link to={backTo}>
          <ArrowLeft aria-hidden="true" size={15} />
          <span>{text.backButton}</span>
        </Link>
      </Button>
    </>
  );

  if (state === "declined") {
    actions = (
      <>
        <Button disabled={busy} onClick={onVerify} size="default" variant="primary">
          {text.tryAnother}
        </Button>
        <Button asChild size="default" variant="secondary">
          <Link to="/profile/billing">{text.choosePlan}</Link>
        </Button>
      </>
    );
  } else if (state === "used") {
    actions = (
      <>
        <Button asChild size="default" variant="primary">
          <Link to="/profile/billing">{text.choosePlan}</Link>
        </Button>
        <Button disabled={busy} onClick={onVerify} size="default" variant="secondary">
          {text.anotherCard}
        </Button>
      </>
    );
  }

  return (
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-8" variant="elevated">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={dsCardTitle} id="ob-h" ref={headingRef} tabIndex={-1}>
          {titleText}
        </h2>
        <Badge variant={badgeVariant}>{pillLabel}</Badge>
      </div>

      <p className={`${dsBody} mt-3 max-w-xl`} role={state === "verify" ? undefined : "alert"}>
        {bodyText}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>

      {error ? (
        <p className="mt-4 text-xs font-semibold text-need" role="alert">
          {text.loadFailed}
        </p>
      ) : null}
    </Card>
  );
}
