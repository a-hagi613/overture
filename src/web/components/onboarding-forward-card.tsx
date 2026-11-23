import { ArrowLeft, Check, CheckCircle2, Copy, Mail } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { ATS_MAIL_DOMAINS } from "../../shared/ats-mail-domains.ts";
import { copy } from "../../shared/copy.ts";
import { OnboardingFilterStep } from "./onboarding-filter-step.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";

const filterDomains = Object.values(ATS_MAIL_DOMAINS).flat().join(" OR ");
const text = copy.onboarding.forward;

export function OnboardingForwardCard({
  address,
  alreadyAgreed,
  backTo = "/onboarding/targets",
  forwardingWorks,
  onStart,
}: {
  address: string;
  alreadyAgreed: boolean;
  backTo?: string;
  forwardingWorks: boolean;
  onStart: () => Promise<void>;
}) {
  const [agreed, setAgreed] = useState(alreadyAgreed);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success(text.copied);
    } catch {
      setCopied(false);
    }
  };

  const start = async () => {
    setStarting(true);
    setFailed(false);

    try {
      await onStart();
    } catch {
      setFailed(true);
      setStarting(false);
    }
  };

  const testMail = `mailto:${address}?subject=${encodeURIComponent(text.testSubject)}`;

  return (
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-8" variant="elevated">
      <h2 className={dsCardTitle} id="ob-h">
        {`${text.titlePlain} ${text.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-2 max-w-xl`}>{text.intro}</p>

      <div className="mt-6">
        <label className={`${dsEyebrow} mb-2 block`} htmlFor="w-addr">
          {text.addressLabel}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input className="font-mono text-xs" id="w-addr" readOnly value={address} />
          <Button
            ariaLabel={text.copyLabel}
            className="shrink-0"
            onClick={() => {
              void copyAddress();
            }}
            size="default"
            variant="secondary"
          >
            {copied ? (
              <Check aria-hidden="true" size={15} />
            ) : (
              <Copy aria-hidden="true" size={15} />
            )}
            <span>{copied ? text.copied : text.copy}</span>
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{text.addressNote}</p>
      </div>

      <div className="mt-6">
        <h3 className={dsEyebrow}>{text.filterTitle}</h3>
        <ol className="mt-3 flex flex-col gap-3.5">
          <OnboardingFilterStep position={1}>
            <p>
              {text.stepOne.before}
              <strong className="font-semibold">{text.stepOne.bold}</strong>
              {text.stepOne.between}
              <strong className="font-semibold">{text.stepOne.boldEnd}</strong>
              {text.stepOne.after}
            </p>
          </OnboardingFilterStep>
          <OnboardingFilterStep position={2}>
            <p>
              {text.stepTwo.before}
              <strong className="font-semibold">{text.stepTwo.bold}</strong>
              {text.stepTwo.after}
            </p>
            <p className="mt-2 break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              {filterDomains}
            </p>
          </OnboardingFilterStep>
          <OnboardingFilterStep position={3}>
            <p>
              {text.stepThree.before}
              <strong className="font-semibold">{text.stepThree.bold}</strong>
              {text.stepThree.after}
            </p>
          </OnboardingFilterStep>
        </ol>
      </div>

      <Card className="mt-6 p-4 shadow-none" variant="muted">
        <p className="text-sm font-semibold text-foreground">{text.checkTitle}</p>
        {forwardingWorks ? (
          <output className="mt-2.5 flex items-center gap-2 text-xs font-medium text-ok">
            <CheckCircle2 aria-hidden="true" size={15} />
            <span>{text.received}</span>
          </output>
        ) : (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <output className="text-xs text-muted-foreground">{text.waiting}</output>
            <Button asChild size="sm" variant="outline">
              <a href={testMail}>
                <Mail aria-hidden="true" size={14} />
                <span>{text.sendTest}</span>
              </a>
            </Button>
          </div>
        )}
        <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
          {text.skipNote}
        </p>
      </Card>

      <label
        className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-input bg-background p-4"
        htmlFor="w-consent"
      >
        <input
          checked={agreed}
          className="mt-0.5 size-4 shrink-0 accent-signal"
          disabled={starting}
          id="w-consent"
          onChange={(event) => {
            setAgreed(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        <span className="text-sm leading-relaxed text-foreground">
          {text.agreeBefore}
          <Link className="font-medium text-signal-text underline underline-offset-4" to="/terms">
            {text.terms}
          </Link>
          {text.agreeBetween}
          <Link className="font-medium text-signal-text underline underline-offset-4" to="/privacy">
            {text.privacy}
          </Link>
          {text.agreeAfter}
        </span>
      </label>

      <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
        {text.firstRun}
      </p>

      {failed ? (
        <p className="mt-3 text-xs font-semibold text-need" role="alert">
          {text.startFailed}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <Button asChild size="default" variant="ghost">
          <Link to={backTo}>
            <ArrowLeft aria-hidden="true" size={15} />
            <span>{copy.onboarding.back}</span>
          </Link>
        </Button>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-4">
          {agreed ? null : (
            <p className="text-right text-xs text-muted-foreground" id="w-why">
              {text.tickToStart}
            </p>
          )}
          <Button
            disabled={!agreed || starting}
            onClick={() => {
              void start();
            }}
            size="lg"
            variant="primary"
          >
            {starting ? text.starting : text.start}
          </Button>
        </div>
      </div>
    </Card>
  );
}
