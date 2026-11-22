import { useState } from "react";
import { Link } from "react-router";

import { ATS_MAIL_DOMAINS } from "../../shared/ats-mail-domains.ts";
import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { OnboardingFilterStep } from "./onboarding-filter-step.tsx";

const FILTER_ATS = ["greenhouse", "lever", "ashby", "workable", "personio"] as const;

const filterDomains = FILTER_ATS.flatMap((ats) => ATS_MAIL_DOMAINS[ats]).join(" OR ");

const text = copy.onboarding.forward;

export function OnboardingForwardCard({
  address,
  alreadyAgreed,
  forwardingWorks,
  onStart,
}: {
  address: string;
  alreadyAgreed: boolean;
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
    <section
      aria-labelledby="ob-h"
      className="obd rounded-lg border border-border bg-card shadow-sh"
    >
      <h2
        className="serif"
        id="ob-h"
        style={{ fontSize: "clamp(28px, 4vw, 36px)", lineHeight: 1.1 }}
      >
        {text.titlePlain} <span className="italic">{text.titleItalic}</span>
      </h2>
      <p className="mt-2.5 max-w-[52ch] text-[14.5px] text-muted-foreground">{text.intro}</p>

      <div className="mt-6">
        <label className="lbl" htmlFor="w-addr">
          {text.addressLabel}
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            className="inp mono"
            id="w-addr"
            readOnly
            style={{ flex: "1 1 260px", fontSize: 13, height: 44, minWidth: 0 }}
            value={address}
          />
          <button
            aria-label={text.copyLabel}
            className="btn2"
            onClick={() => {
              void copyAddress();
            }}
            style={{ minHeight: 44 }}
            type="button"
          >
            <NavGlyph name="copy" size={16} />
            {copied ? text.copied : text.copy}
          </button>
        </div>
        <p className="hint mt-1.5">{text.addressNote}</p>
      </div>

      <div className="mt-[26px]">
        <h3 className="lbl">{text.filterTitle}</h3>
        <ol className="mt-3 flex list-none flex-col gap-3.5 p-0">
          <OnboardingFilterStep position={1}>
            <p>
              {text.stepOne.before}
              <strong>{text.stepOne.bold}</strong>
              {text.stepOne.between}
              <strong>{text.stepOne.boldEnd}</strong>
              {text.stepOne.after}
            </p>
          </OnboardingFilterStep>
          <OnboardingFilterStep position={2}>
            <p>
              {text.stepTwo.before}
              <strong>{text.stepTwo.bold}</strong>
              {text.stepTwo.after}
            </p>
            <p className="mono mt-2 rounded-md border border-border bg-muted px-3 py-2.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
              {filterDomains}
            </p>
          </OnboardingFilterStep>
          <OnboardingFilterStep position={3}>
            <p>
              {text.stepThree.before}
              <strong>{text.stepThree.bold}</strong>
              {text.stepThree.after}
            </p>
          </OnboardingFilterStep>
        </ol>
      </div>

      <div className="mt-[26px] rounded-[10px] border border-input bg-background px-[18px] pt-[18px] pb-4">
        <p className="text-[15px] font-semibold">{text.checkTitle}</p>
        {forwardingWorks ? (
          <output className="okbox mt-3">
            <span className="mt-px flex-none">
              <NavGlyph name="check" size={16} />
            </span>
            <p className="text-[13.5px] text-foreground">{text.received}</p>
          </output>
        ) : (
          <>
            <output className="mt-1 block text-[14px] text-muted-foreground">{text.waiting}</output>
            <a className="btn2 mt-3" href={testMail} style={{ minHeight: 44 }}>
              {text.sendTest}
            </a>
          </>
        )}
        <p className="mt-3.5 border-t border-border pt-3 text-[13px] text-muted-foreground">
          {text.skipNote}
        </p>
      </div>

      <div className="mt-[26px] flex items-start gap-3">
        <input
          checked={agreed}
          className="mt-0.5 size-5 flex-none cursor-pointer accent-[var(--color-foreground)]"
          disabled={starting}
          id="w-consent"
          onChange={(event) => {
            setAgreed(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        <label className="cursor-pointer text-[14px] leading-[1.5]" htmlFor="w-consent">
          {text.agreeBefore}
          <Link className="text-[color:var(--acct)] underline" to="/terms">
            {text.terms}
          </Link>
          {text.agreeBetween}
          <Link className="text-[color:var(--acct)] underline" to="/privacy">
            {text.privacy}
          </Link>
          {text.agreeAfter}
        </label>
      </div>

      <p className="mt-[22px] border-t border-border pt-4 text-[14px]">{text.firstRun}</p>

      {failed ? (
        <p className="hint mt-4 text-[color:var(--need)]" role="alert">
          {text.startFailed}
        </p>
      ) : null}

      <div className="ftr mt-5 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Link className="btng" style={{ minHeight: 44 }} to="/onboarding/targets">
          <NavGlyph name="back" size={16} />
          {copy.onboarding.back}
        </Link>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2.5">
          {agreed ? null : (
            <p className="hint text-right" id="w-why">
              {text.tickToStart}
            </p>
          )}
          <button
            aria-describedby={agreed ? undefined : "w-why"}
            className="btn"
            disabled={!agreed || starting}
            onClick={() => {
              void start();
            }}
            style={{ minHeight: 48, padding: "0 26px" }}
            type="button"
          >
            {starting ? text.starting : text.start}
          </button>
        </div>
      </div>
    </section>
  );
}
