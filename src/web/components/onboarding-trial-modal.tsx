import { Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { ArrowRight, CheckCircle2, Lock, X } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import type { OnboardingMatchView } from "../lib/onboarding-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

const text = copy.onboarding.trial;

export type TrialCardState = "verify" | "declined" | "used";

export function OnboardingTrialModal({
  busy,
  consentSlot,
  disabled,
  error,
  hasApplications = false,
  onOpenChange,
  onVerify,
  open,
  returned,
  selectedMatches,
  state,
}: {
  busy: boolean;
  consentSlot: ReactNode;
  disabled: boolean;
  error: boolean;
  hasApplications?: boolean | undefined;
  onOpenChange: (open: boolean) => void;
  onVerify: () => void;
  open: boolean;
  returned: boolean;
  selectedMatches: readonly OnboardingMatchView[];
  state: TrialCardState;
}) {
  let badgeVariant: "ok" | "need" | "signal" = "ok";
  let badgeLabel: string = text.modalBadge;
  let titleText: string = text.modalTitle;
  let leadText: string = text.modalReassurance;

  if (state === "declined") {
    badgeVariant = "need";
    badgeLabel = text.declinedTitle;
    titleText = text.declinedTitle;
    leadText = text.declinedBody;
  } else if (state === "used") {
    badgeVariant = "signal";
    badgeLabel = text.usedTitle;
    titleText = text.usedHeading;
    leadText = text.usedBody;
  }

  let ctaLabel: string = returned ? text.ctaReturnButton : text.ctaButton;

  if (hasApplications && !returned) {
    ctaLabel = text.ctaDirectButton;
  }

  if (busy) {
    ctaLabel = text.ctaBusy;
  }

  const showStripeCopy = !hasApplications || returned;

  let footerSlot = (
    <>
      <div className="mt-4 border-t border-border pt-4">{consentSlot}</div>
      <Button
        ariaBusy={busy}
        className="mt-4 w-full"
        disabled={busy || disabled}
        onClick={onVerify}
        size="lg"
        variant="primary"
      >
        <span>{ctaLabel}</span>
        <ArrowRight aria-hidden="true" size={16} />
      </Button>
      {showStripeCopy ? (
        <p className="mt-2.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden="true" size={12} />
          <span>{text.stripeNote}</span>
        </p>
      ) : null}
      {disabled ? (
        <output className="mt-2 block text-center text-xs font-medium text-muted-foreground">
          {text.consentRequired}
        </output>
      ) : null}
    </>
  );

  if (state === "declined") {
    footerSlot = (
      <div className="mt-5 flex flex-wrap gap-2.5">
        <Button disabled={busy} onClick={onVerify} size="default" variant="primary">
          {text.tryAnother}
        </Button>
        <Button asChild size="default" variant="secondary">
          <Link to="/profile/billing">{text.choosePlan}</Link>
        </Button>
      </div>
    );
  } else if (state === "used") {
    footerSlot = (
      <div className="mt-5 flex flex-wrap gap-2.5">
        <Button asChild size="default" variant="primary">
          <Link to="/profile/billing">{text.choosePlan}</Link>
        </Button>
        <Button disabled={busy} onClick={onVerify} size="default" variant="secondary">
          {text.anotherCard}
        </Button>
      </div>
    );
  }

  return (
    <Root onOpenChange={onOpenChange} open={open}>
      <Portal>
        <Overlay className="ov-overlay-in fixed inset-0 z-50 bg-scrim backdrop-blur-xs" />
        <Content className="ov-pop-in fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-11/12 max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lift focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <Badge variant={badgeVariant}>{badgeLabel}</Badge>
            <Button
              ariaLabel={copy.codePaste.close}
              onClick={() => {
                onOpenChange(false);
              }}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden="true" size={16} />
            </Button>
          </div>

          <Title className={`${dsCardTitle} mt-3`}>{titleText}</Title>
          <Description className={`${dsBody} mt-2 text-foreground`}>{leadText}</Description>

          {state === "verify" ? (
            <>
              {showStripeCopy ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {returned ? text.returnReadyNote : text.modalReason}
                </p>
              ) : null}
              {selectedMatches.length === 0 ? null : (
                <ul className="mt-4 space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
                  {selectedMatches.map((match) => (
                    <li className="flex items-center gap-2 text-xs text-foreground" key={match.id}>
                      <CheckCircle2 aria-hidden="true" className="shrink-0 text-ok" size={13} />
                      <span className="truncate font-medium">{`${match.title} · ${match.company}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {footerSlot}

          {error ? (
            <p className="mt-3 text-xs font-semibold text-need" role="alert">
              {text.loadFailed}
            </p>
          ) : null}
        </Content>
      </Portal>
    </Root>
  );
}
