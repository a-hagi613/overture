import { ButtonLink } from "../components/button-link.tsx";
import { MarketingEyebrow } from "../components/marketing-eyebrow.tsx";
import { MarketingPage } from "../components/marketing-page.tsx";
import { MarketingPlanEyebrow } from "../components/marketing-plan-eyebrow.tsx";
import { marketingCopy } from "../../shared/marketing-copy.ts";

const copy = marketingCopy.pricing;

/**
 * The public pricing page at `/pricing`, prerendered to static HTML by `scripts/prerender.tsx`.
 *
 * @returns The pricing page element.
 */
export function PricingPage() {
  return (
    <MarketingPage footerAfterContent>
      <section className="mx-auto w-full max-w-[1200px] px-4 pt-8 md:px-10 md:pt-16">
        <MarketingEyebrow>{copy.eyebrow}</MarketingEyebrow>
        <h1 className="mt-3 font-serif text-[44px] leading-[1.04] tracking-[0]! text-foreground md:mt-3.5 md:text-[64px] md:tracking-[-0.01em]!">
          {copy.headline}
        </h1>
        <p className="mt-3.5 max-w-[680px] text-[16px] leading-[1.55] text-muted-foreground md:mt-4 md:text-[18px]">
          {copy.lede}
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
          <article className="flex flex-col rounded-xl border border-border bg-card p-7">
            <MarketingPlanEyebrow>{copy.trial.eyebrow}</MarketingPlanEyebrow>
            <h2 className="mt-2 font-serif text-[34px] tracking-[0]!">{copy.trial.name}</h2>
            <p className="mt-[18px] font-serif text-[56px] leading-none tracking-[0]! md:text-[64px]">
              {copy.trial.price}
            </p>
            <p className="mt-4 text-[18px] font-semibold">{copy.trial.allowance}</p>
            <p className="text-[14px] text-muted-foreground">{copy.trial.allowanceNote}</p>
            <ul className="mt-5 mb-6 list-disc pl-[18px] text-[15px] [&>li]:mb-2">
              {copy.trial.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className="mt-auto">
              <ButtonLink href="/signin" variant="secondary">
                {marketingCopy.cta.startTrial}
              </ButtonLink>
            </div>
          </article>

          <article className="flex flex-col rounded-xl border border-input bg-card p-7">
            <MarketingPlanEyebrow>{copy.week.eyebrow}</MarketingPlanEyebrow>
            <h2 className="mt-2 font-serif text-[34px] tracking-[0]!">{copy.week.name}</h2>
            <p className="mt-[18px] font-serif text-[56px] leading-none tracking-[0]! md:text-[64px]">
              {copy.week.price}
              <span className="font-sans text-[16px] text-muted-foreground">
                {" "}
                {copy.week.priceNote}
              </span>
            </p>
            <p className="mt-4 text-[18px] font-semibold">{copy.week.allowance}</p>
            <p className="text-[14px] text-muted-foreground">{copy.week.allowanceNote}</p>
            <ul className="mt-5 mb-6 list-disc pl-[18px] text-[15px] [&>li]:mb-2">
              {copy.week.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className="mt-auto">
              <ButtonLink href="/signin" variant="secondary">
                {marketingCopy.cta.chooseWeek}
              </ButtonLink>
            </div>
          </article>

          <article className="flex flex-col rounded-xl border border-input bg-card p-7">
            <MarketingPlanEyebrow>{copy.month.eyebrow}</MarketingPlanEyebrow>
            <h2 className="mt-2 font-serif text-[34px] tracking-[0]!">{copy.month.name}</h2>
            <p className="mt-[18px] font-serif text-[56px] leading-none tracking-[0]! md:text-[64px]">
              {copy.month.price}
              <span className="font-sans text-[16px] text-muted-foreground">
                {" "}
                {copy.month.priceNote}
              </span>
            </p>
            <p className="mt-4 text-[18px] font-semibold">{copy.month.allowance}</p>
            <p className="text-[14px] text-muted-foreground">{copy.month.allowanceNote}</p>
            <ul className="mt-5 mb-6 list-disc pl-[18px] text-[15px] [&>li]:mb-2">
              {copy.month.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className="mt-auto">
              <ButtonLink href="/signin" variant="primary">
                {marketingCopy.cta.chooseMonth}
              </ButtonLink>
            </div>
          </article>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1200px] px-4 pt-7 md:px-10 md:pt-14">
        <div className="rounded-xl bg-muted p-6 md:px-9 md:py-8">
          <h2 className="font-serif text-[30px] leading-[1.1] tracking-[0]! text-foreground md:text-[40px]">
            {copy.failureTitle}
          </h2>
          <p className="mt-3 max-w-[760px] text-[16px] leading-[1.55] text-muted-foreground">
            {copy.failureBody}
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1200px] px-4 pt-10 md:px-10 md:pt-14">
        <h2 className="font-serif text-[30px] leading-[1.1] tracking-[0]! text-foreground md:text-[36px]">
          {copy.includesTitle}
        </h2>
        <ul className="mt-4 list-disc pl-[18px] text-[15px] text-foreground md:columns-2 md:gap-x-4 md:text-[16px]">
          {copy.includes.map((line) => (
            <li className="mb-2 break-inside-avoid" key={line}>
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto w-full max-w-[1200px] px-4 pt-10 md:px-10 md:pt-12 md:pb-4">
        <ButtonLink href="/signin" variant="primary">
          {marketingCopy.cta.startTrial}
        </ButtonLink>
      </section>

      <div className="h-6 md:hidden" />
    </MarketingPage>
  );
}
