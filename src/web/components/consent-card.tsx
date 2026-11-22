import { useState } from "react";
import { Link } from "react-router";

import type { ConsentState } from "../../shared/consent.ts";

import { copy } from "../../shared/copy.ts";
import { longDate } from "../lib/consent-format.ts";
import { useAcceptConsent } from "../lib/consent-api.ts";

const linkClass =
  "underline decoration-input underline-offset-[3px] transition-colors hover:decoration-foreground";

export function ConsentCard({ state }: { state: ConsentState }) {
  const accept = useAcceptConsent();
  const agreed = state.accepted?.version === state.current.version;
  const [checked, setChecked] = useState(agreed);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    if (checked || accept.isPending) {
      return;
    }

    setFailed(false);

    try {
      await accept.mutateAsync(state.current.version);
      setChecked(true);
    } catch {
      setChecked(false);
      setFailed(true);
    }
  };

  return (
    <section
      aria-labelledby="consent-title"
      className="flex flex-col gap-[18px] rounded-[10px] border border-border bg-card px-[18px] py-[20px] shadow-lift md:px-[28px] md:pb-[24px] md:pt-[28px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[10px]">
        <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          {copy.consent.eyebrow}
        </p>
        <span className="inline-flex items-center gap-[8px] self-start rounded-full border border-input bg-card px-[11px] py-[3px] font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {copy.consent.versionWord}{" "}
          <span className="font-mono text-[11.5px] font-normal normal-case tracking-normal text-foreground">
            {state.current.version}
          </span>
        </span>
      </div>
      <h1 className="font-serif text-[34px] leading-[1.08] tracking-[-0.012em]" id="consent-title">
        {copy.consent.titleBefore}
        <em className="italic">{copy.consent.titleItalic}</em>
        {copy.consent.titleAfter}
      </h1>
      <div className="max-w-[62ch] space-y-[10px] text-[14.5px] leading-[1.66]">
        <p>{state.current.text}</p>
        <p>
          {copy.consent.readNoticeBefore}
          <Link className={linkClass} to="/terms">
            {copy.legal.termsLink}
          </Link>
          {copy.consent.readNoticeBetween}
          <Link className={linkClass} to="/privacy">
            {copy.legal.privacyLink}
          </Link>
          {copy.consent.readNoticeEnd}
        </p>
      </div>
      <label
        className="flex cursor-pointer items-start gap-[12px] rounded-[8px] border border-input bg-card px-[14px] py-[14px] text-[14px] leading-[1.5]"
        htmlFor="consent-agree"
      >
        <input
          checked={checked}
          className="mt-[1px] size-[20px] flex-none cursor-pointer rounded-sm accent-[var(--color-foreground)]"
          disabled={accept.isPending}
          id="consent-agree"
          onChange={() => {
            void toggle();
          }}
          type="checkbox"
        />
        <span className="font-semibold text-foreground">{copy.consent.agree}</span>
      </label>
      <p className="max-w-[60ch] text-[12.5px] leading-[1.55] text-muted-foreground">
        {copy.consent.footnote}
      </p>
      {state.accepted === null ? null : (
        <output className="block text-[12.5px] leading-[1.55] text-muted-foreground">
          {copy.consent.accepted(state.accepted.version, longDate(state.accepted.at))}
        </output>
      )}
      {failed ? (
        <p className="text-[12.5px] leading-[1.55] text-need" role="alert">
          {copy.consent.acceptFailed}
        </p>
      ) : null}
    </section>
  );
}
