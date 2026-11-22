import { ButtonLink } from "../components/button-link.tsx";
import { MarketingEyebrow } from "../components/marketing-eyebrow.tsx";
import { MarketingPage } from "../components/marketing-page.tsx";
import { PUBLIC_ATS } from "../../shared/plans.ts";
import { marketingCopy } from "../../shared/marketing-copy.ts";

const copy = marketingCopy.landing;
const pricingLink = "/pricing";

/**
 * The public landing at `/`, prerendered to static HTML by `scripts/prerender.tsx`.
 *
 * @returns The landing page element.
 */
export function LandingPage() {
  return (
    <MarketingPage>
      <section className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-16 pt-10 lg:grid-cols-[1fr_480px] lg:gap-16 md:px-10 md:pb-24 md:pt-[72px]">
        <div className="flex flex-col gap-6">
          <MarketingEyebrow>{copy.eyebrow}</MarketingEyebrow>
          <h1 className="font-serif text-[44px] leading-[1.02] tracking-tight lg:text-[76px] md:text-[64px]">
            {copy.headline}
          </h1>
          <p className="max-w-[560px] text-[16px] leading-[1.6] text-muted-foreground md:text-[18px]">
            {copy.lede}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/signin" variant="primary">
              {marketingCopy.cta.startTrial}
            </ButtonLink>
            <ButtonLink href={pricingLink} variant="secondary">
              {marketingCopy.cta.seePlans}
            </ButtonLink>
          </div>
          <p className="text-[14px] text-muted-foreground">{copy.trialNote}</p>
        </div>

        <aside
          aria-label={copy.previewStatus}
          className="relative self-start rounded-xl border border-border border-l-[3px] border-l-[var(--color-ok)] bg-card p-5 md:p-6"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ok">
              {copy.previewStatus}
            </span>
            <span className="font-mono text-[12px] text-muted-foreground">{copy.previewVia}</span>
          </div>
          <p className="mt-3 font-serif text-[30px] leading-tight">{copy.previewRole}</p>
          <p className="text-[15px] text-muted-foreground">{copy.previewCompany}</p>
          <dl className="mt-4 divide-y divide-border border-y border-border text-[14px]">
            {copy.previewRows.map(([label, value]) => (
              <div className="flex justify-between gap-4 py-2.5" key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex gap-2">
            <span className="inline-flex min-h-[46px] items-center rounded-lg bg-foreground px-5 text-[15px] font-semibold text-background">
              {copy.previewSend}
            </span>
            <span className="inline-flex min-h-[46px] items-center rounded-lg border border-input bg-card px-5 text-[15px] font-semibold">
              {copy.previewSkip}
            </span>
          </div>
        </aside>
      </section>

      <section
        aria-labelledby="where-it-applies-title"
        className="mx-auto max-w-[1200px] px-4 py-12 md:px-10 md:py-20"
        id="where-it-applies"
      >
        <MarketingEyebrow>{copy.atsEyebrow}</MarketingEyebrow>
        <div className="mt-3 grid gap-6 lg:grid-cols-2 lg:items-end">
          <h2
            className="font-serif text-[34px] leading-tight md:text-[40px]"
            id="where-it-applies-title"
          >
            {copy.atsTitle}
          </h2>
          <p className="text-[15px] text-muted-foreground">{copy.atsNote}</p>
        </div>
        <ul className="mt-6 flex flex-wrap gap-2.5">
          {PUBLIC_ATS.map((ats) => (
            <li
              className="inline-flex min-h-[42px] items-center rounded-full border border-input bg-card px-4 text-[15px]"
              key={ats}
            >
              {ats}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="how-it-works-title"
        className="mx-auto max-w-[1200px] px-4 py-12 md:px-10 md:py-20"
        id="how-it-works"
      >
        <MarketingEyebrow>{copy.howEyebrow}</MarketingEyebrow>
        <h2 className="sr-only" id="how-it-works-title">
          {copy.howEyebrow}
        </h2>
        <ol className="mt-6 grid gap-8 lg:grid-cols-3 lg:gap-10">
          {copy.steps.map((step) => (
            <li className="border-t border-border pt-5" key={step.label}>
              <p className="font-mono text-[13px] text-muted-foreground">{step.label}</p>
              <h3 className="mt-2 font-serif text-[28px] leading-tight md:text-[30px]">
                {step.title}
              </h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-12 md:px-10 md:py-16">
        <h2 className="font-serif text-[34px] leading-tight md:text-[40px]">{copy.boardTitle}</h2>
        <p className="mt-2 text-[16px] text-muted-foreground">{copy.boardLede}</p>
        <ol className="mt-8 grid gap-4 lg:grid-cols-3">
          {copy.stages.map((stage) => (
            <li className="rounded-xl border border-border bg-card p-5" key={stage.title}>
              <p className="font-serif text-[26px] leading-tight">{stage.title}</p>
              <p className="mt-2 text-[14px] text-muted-foreground">{stage.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 md:px-10">
        <div className="rounded-xl bg-muted p-6 md:p-12">
          <h2 className="font-serif text-[34px] leading-tight md:text-[40px]">
            {copy.failureTitle}
          </h2>
          <p className="mt-3 max-w-[760px] text-[16px] leading-[1.6] text-muted-foreground">
            {copy.failureBody}
          </p>
        </div>
      </section>

      <section className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-14 md:flex-row md:items-center md:justify-between md:px-10 md:py-20">
        <h2 className="font-serif text-[36px] leading-tight md:text-[44px]">{copy.closingTitle}</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/signin" variant="primary">
            {marketingCopy.cta.startTrial}
          </ButtonLink>
          <ButtonLink href={pricingLink} variant="secondary">
            {marketingCopy.cta.seePlans}
          </ButtonLink>
        </div>
      </section>
    </MarketingPage>
  );
}
