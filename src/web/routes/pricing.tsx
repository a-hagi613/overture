import { ButtonLink } from "../components/button-link.tsx";
import { MarketingEyebrow } from "../components/marketing-eyebrow.tsx";
import { MarketingPage } from "../components/marketing-page.tsx";
import { marketingCopy } from "../../shared/marketing-copy.ts";

const copy = marketingCopy.pricing;

/**
 * The public pricing page at `/pricing`, prerendered to static HTML by `scripts/prerender.tsx`.
 *
 * @returns The pricing page element.
 */
export function PricingPage() {
  return (
    <MarketingPage>
      <section className="mx-auto max-w-[1200px] px-4 pb-10 pt-10 md:px-10 md:pt-[64px]">
        <MarketingEyebrow>{copy.eyebrow}</MarketingEyebrow>
        <h1 className="mt-4 font-serif text-[44px] leading-[1.02] tracking-tight md:text-[64px]">
          {copy.headline}
        </h1>
        <p className="mt-4 max-w-[680px] text-[16px] leading-[1.6] text-muted-foreground md:text-[18px]">
          {copy.lede}
        </p>
      </section>

      <section
        aria-label="Plans"
        className="mx-auto grid max-w-[1200px] gap-5 px-4 md:grid-cols-3 md:px-10"
      >
        <article className="flex flex-col rounded-xl border border-border bg-card p-6 md:p-7">
          <MarketingEyebrow>{copy.trial.eyebrow}</MarketingEyebrow>
          <h2 className="mt-3 font-serif text-[34px] leading-tight">{copy.trial.name}</h2>
          <p className="mt-4 font-serif text-[48px] leading-none md:text-[52px]">
            {copy.trial.price}
          </p>
          <p className="mt-4 text-[18px] font-semibold">{copy.trial.allowance}</p>
          <p className="text-[14px] text-muted-foreground">{copy.trial.allowanceNote}</p>
          <ul className="mt-5 list-disc space-y-2 pl-5 text-[15px]">
            {copy.trial.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            <ButtonLink href="/signin" variant="secondary">
              {marketingCopy.cta.startTrial}
            </ButtonLink>
          </div>
        </article>

        <article className="flex flex-col rounded-xl border border-border bg-card p-6 md:p-7">
          <MarketingEyebrow>{copy.week.eyebrow}</MarketingEyebrow>
          <h2 className="mt-3 font-serif text-[34px] leading-tight">{copy.week.name}</h2>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="font-serif text-[52px] leading-none">{copy.week.price}</span>
            <span className="text-[16px] text-muted-foreground">{copy.week.priceNote}</span>
          </p>
          <p className="mt-4 text-[18px] font-semibold">{copy.week.allowance}</p>
          <p className="text-[14px] text-muted-foreground">{copy.week.allowanceNote}</p>
          <ul className="mt-5 list-disc space-y-2 pl-5 text-[15px]">
            {copy.week.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            <ButtonLink href="/signin" variant="secondary">
              {marketingCopy.cta.chooseWeek}
            </ButtonLink>
          </div>
        </article>

        <article className="flex flex-col rounded-xl border border-foreground/30 bg-card p-6 md:p-7">
          <MarketingEyebrow>{copy.month.eyebrow}</MarketingEyebrow>
          <h2 className="mt-3 font-serif text-[34px] leading-tight">{copy.month.name}</h2>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="font-serif text-[52px] leading-none">{copy.month.price}</span>
            <span className="text-[16px] text-muted-foreground">{copy.month.priceNote}</span>
          </p>
          <p className="mt-4 text-[18px] font-semibold">{copy.month.allowance}</p>
          <p className="text-[14px] text-muted-foreground">{copy.month.allowanceNote}</p>
          <ul className="mt-5 list-disc space-y-2 pl-5 text-[15px]">
            {copy.month.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            <ButtonLink href="/signin" variant="primary">
              {marketingCopy.cta.chooseMonth}
            </ButtonLink>
          </div>
        </article>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-12 md:px-10 md:py-16">
        <div className="rounded-xl bg-muted p-6 md:p-12">
          <h2 className="font-serif text-[34px] leading-tight md:text-[40px]">
            {copy.failureTitle}
          </h2>
          <p className="mt-3 max-w-[760px] text-[16px] leading-[1.6] text-muted-foreground">
            {copy.failureBody}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-16 md:px-10 md:pb-24">
        <h2 className="font-serif text-[34px] leading-tight md:text-[36px]">
          {copy.includesTitle}
        </h2>
        <ul className="mt-5 grid list-disc gap-x-10 gap-y-3 pl-5 text-[16px] md:grid-cols-2">
          {copy.includes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="mt-10">
          <ButtonLink href="/signin" variant="primary">
            {marketingCopy.cta.startTrial}
          </ButtonLink>
        </div>
      </section>
    </MarketingPage>
  );
}
