import { ButtonLink } from "../components/button-link.tsx";
import { MarketingPage } from "../components/marketing-page.tsx";
import { marketingCopy } from "../../shared/marketing-copy.ts";

const copy = marketingCopy.pricing;
const eyebrowClass = "font-mono text-[12px] uppercase tracking-[0.04em] text-muted-foreground";

const planClass =
  "box-border flex flex-col rounded-xl border border-border bg-card p-7 md:flex-1 md:border-input";

const planNameClass = "mt-2 font-serif text-[34px] leading-[1.55]";

const planPriceClass = "mt-[18px] font-serif text-[56px] leading-none md:text-[64px]";

const planAllowanceClass = "mt-4 text-[18px] font-semibold";

const planBulletsClass = "mb-8 mt-5 list-disc space-y-2 pl-[18px] text-[15px]";

const ctaWrapClass = "mt-auto pt-0";

/**
 * The public pricing page at `/pricing`, prerendered to static HTML by `scripts/prerender.tsx`.
 * Laid out from the canvas Pricing boards (`design/reference/pricing/`).
 *
 * @returns The pricing page element.
 */
export function PricingPage() {
  return (
    <MarketingPage>
      <div className="leading-[1.55]">
        <section className="mx-auto max-w-[1200px] px-4 pt-8 md:px-10 md:pt-16">
          <p className={`${eyebrowClass} md:text-[13px]`}>{copy.eyebrow}</p>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.04] tracking-[-0.01em] md:mt-3.5 md:text-[64px]">
            {copy.headline}
          </h1>
          <p className="mt-[14px] max-w-[680px] text-[16px] leading-[1.55] text-muted-foreground md:mt-4 md:text-[18px]">
            {copy.lede}
          </p>
        </section>

        <section
          aria-label="Plans"
          className="mx-auto mt-10 flex max-w-[1200px] flex-col gap-4 px-4 md:flex-row md:gap-5 md:px-10"
        >
          <article className={planClass}>
            <p className={eyebrowClass}>{copy.trial.eyebrow}</p>
            <h2 className={planNameClass}>{copy.trial.name}</h2>
            <p className={planPriceClass}>{copy.trial.price}</p>
            <p className={planAllowanceClass}>{copy.trial.allowance}</p>
            <p className="text-[14px] text-muted-foreground">{copy.trial.allowanceNote}</p>
            <ul className={planBulletsClass}>
              {copy.trial.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className={ctaWrapClass}>
              <ButtonLink className="px-[22px] md:px-6" href="/signin" variant="secondary">
                {marketingCopy.cta.startTrial}
              </ButtonLink>
            </div>
          </article>

          <article className={planClass}>
            <p className={eyebrowClass}>{copy.week.eyebrow}</p>
            <h2 className={planNameClass}>{copy.week.name}</h2>
            <p className={planPriceClass}>
              {copy.week.price}
              <span className="font-sans text-[16px] font-normal text-muted-foreground">
                {" "}
                {copy.week.priceNote}
              </span>
            </p>
            <p className={planAllowanceClass}>{copy.week.allowance}</p>
            <p className="text-[14px] text-muted-foreground">{copy.week.allowanceNote}</p>
            <ul className={planBulletsClass}>
              {copy.week.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className={ctaWrapClass}>
              <ButtonLink className="px-[22px] md:px-6" href="/signin" variant="secondary">
                {marketingCopy.cta.chooseWeek}
              </ButtonLink>
            </div>
          </article>

          <article className={planClass}>
            <p className={eyebrowClass}>{copy.month.eyebrow}</p>
            <h2 className={planNameClass}>{copy.month.name}</h2>
            <p className={planPriceClass}>
              {copy.month.price}
              <span className="font-sans text-[16px] font-normal text-muted-foreground">
                {" "}
                {copy.month.priceNote}
              </span>
            </p>
            <p className={planAllowanceClass}>{copy.month.allowance}</p>
            <p className="text-[14px] text-muted-foreground">{copy.month.allowanceNote}</p>
            <ul className={planBulletsClass}>
              {copy.month.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className={ctaWrapClass}>
              <ButtonLink className="px-[22px] md:px-6" href="/signin" variant="primary">
                {marketingCopy.cta.chooseMonth}
              </ButtonLink>
            </div>
          </article>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 md:px-10">
          <div className="mt-7 rounded-xl bg-muted p-6 md:mt-14 md:px-9 md:py-8">
            <h2 className="font-serif text-[30px] leading-[1.1] md:text-[40px]">
              {copy.failureTitle}
            </h2>
            <p className="mt-3 max-w-[760px] text-[16px] leading-[1.55] text-muted-foreground">
              {copy.failureBody}
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 pt-10 md:px-10 md:pt-14">
          <h2 className="font-serif text-[30px] leading-[1.1] md:text-[36px]">
            {copy.includesTitle}
          </h2>
          <ul className="mt-4 list-disc pl-[18px] text-[15px] md:columns-2 md:gap-x-4 md:text-[16px]">
            {copy.includes.map((line) => (
              <li key={line} className="mb-2 break-inside-avoid">
                {line}
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 pb-4 pt-10 md:px-10 md:pb-4 md:pt-12">
          <ButtonLink className="px-[22px] md:px-6" href="/signin" variant="primary">
            {marketingCopy.cta.startTrial}
          </ButtonLink>
        </section>
        <div aria-hidden="true" className="h-[13px] md:hidden" />
      </div>
    </MarketingPage>
  );
}
