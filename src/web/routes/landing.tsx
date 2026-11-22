import { marketingCopy } from "../../shared/marketing-copy.ts";
import { NavGlyph } from "../components/nav-glyph.tsx";
import type { GlyphName } from "../components/nav-glyph.tsx";
import { MarketingLandingBand } from "../components/marketing-landing-band.tsx";
import { MarketingLandingFlow } from "../components/marketing-landing-flow.tsx";
import { MarketingLandingHero } from "../components/marketing-landing-hero.tsx";
import { MarketingLandingReplies } from "../components/marketing-landing-replies.tsx";
import { MarketingPage } from "../components/marketing-page.tsx";

const { landing: copy } = marketingCopy;
const { pricing } = marketingCopy;

interface PlanCardProps {
  allowance: string;
  allowanceNote: string;
  bullets: readonly string[];
  cta: string;
  eyebrow: string;
  href: string;
  name: string;
  price: string;
  priceNote?: string;
  primary?: boolean;
}

function planCard({
  allowance,
  allowanceNote,
  bullets,
  cta,
  eyebrow,
  href,
  name,
  price,
  priceNote,
  primary,
}: PlanCardProps) {
  return (
    <article className={primary === true ? "card plan primary" : "card plan"}>
      <p className="lbl plan-eyebrow">{eyebrow}</p>
      <h3 className="serif plan-name">{name}</h3>
      <p className="plan-price">
        <span className="serif it">{price}</span>
        {priceNote === undefined ? null : <span className="plan-price-note">{priceNote}</span>}
      </p>
      <hr className="rule" />
      <p className="plan-allowance">{allowance}</p>
      <p className="plan-allowance-note">{allowanceNote}</p>
      <ul className="plan-bullets">
        {bullets.map((bullet) => (
          <li key={bullet}>
            <NavGlyph name="check" size={16} />
            {bullet}
          </li>
        ))}
      </ul>
      <a className={primary === true ? "btn plan-cta" : "btn2 plan-cta"} href={href}>
        {cta}
      </a>
    </article>
  );
}

const proofIcons = {
  "01": "doc",
  "02": "review",
  "03": "clock",
} satisfies Record<string, GlyphName>;

function controlSection() {
  return (
    <section className="wrap landing-control" id="control">
      <div className="section-head">
        <div>
          <p className="eyebrow">{copy.controlEyebrow}</p>
          <h2 className="t display control-title">
            {copy.controlTitleLead} <span className="it">{copy.controlTitleItalic}</span>
          </h2>
        </div>
        <p className="section-lede">{copy.controlLede}</p>
      </div>
      <div className="cgrid">
        {copy.control.map((card) => (
          <article className="card ccard" key={card.number}>
            <span className="cnm">{card.number}</span>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
            <div className="cproof">
              <NavGlyph name={proofIcons[card.number]} size={15} />
              <span>{card.proof}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function boardStages() {
  return (
    <section aria-labelledby="board-stages-title" className="wrap board-stages">
      <h2 className="display" id="board-stages-title">
        {copy.boardTitle}
      </h2>
      <p className="board-lede">{copy.boardLede}</p>
      <div className="stages">
        <span aria-hidden="true" className="stages-rule" />
        <ol className="stage-cards">
          {copy.stages.map((stage, index) => (
            <li className="stage-card" key={stage.title}>
              {index === 1 ? <span aria-hidden="true" className="stage-live" /> : null}
              <p className="serif stage-name">{stage.title}</p>
              <p className="stage-body">{stage.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function failureSection() {
  return (
    <section className="wrap landing-failure">
      <div className="failure">
        <h2 className="display">{copy.failureTitle}</h2>
        <p>{copy.failureBody}</p>
      </div>
    </section>
  );
}

function pricingSection() {
  return (
    <section className="pricing" id="pricing">
      <div className="wrap pricing-inner">
        <div className="pricing-head">
          <p className="eyebrow">{copy.pricingEyebrow}</p>
          <h2 className="t display">{copy.pricingTitle}</h2>
          <p>{copy.pricingLede}</p>
        </div>
        <div className="pricing-grid">
          {planCard({
            allowance: pricing.trial.allowance,
            allowanceNote: pricing.trial.allowanceNote,
            bullets: pricing.trial.bullets,
            cta: marketingCopy.cta.startTrial,
            eyebrow: pricing.trial.eyebrow,
            href: "/signin",
            name: pricing.trial.name,
            price: pricing.trial.price,
          })}
          {planCard({
            allowance: pricing.week.allowance,
            allowanceNote: pricing.week.allowanceNote,
            bullets: pricing.week.bullets,
            cta: marketingCopy.cta.chooseWeek,
            eyebrow: pricing.week.eyebrow,
            href: "/pricing",
            name: pricing.week.name,
            price: pricing.week.price,
            priceNote: pricing.week.priceNote,
          })}
          {planCard({
            allowance: pricing.month.allowance,
            allowanceNote: pricing.month.allowanceNote,
            bullets: pricing.month.bullets,
            cta: marketingCopy.cta.chooseMonth,
            eyebrow: pricing.month.eyebrow,
            href: "/pricing",
            name: pricing.month.name,
            price: pricing.month.price,
            priceNote: pricing.month.priceNote,
            primary: true,
          })}
        </div>
        <div className="pricing-foot">
          <h3 className="display">{copy.pricingIncludesTitle}</h3>
          <ul className="pricing-includes">
            {copy.pricingIncludes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="pricing-actions">
            <a className="btn" href="/signin">
              {marketingCopy.cta.startTrial}
            </a>
            <a className="btn2" href="/pricing">
              {copy.pricingSeeAll}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function faqSection() {
  return (
    <section className="wrap faq" id="faq">
      <div className="faq-grid">
        <div>
          <p className="eyebrow">{copy.faqEyebrow}</p>
          <h2 className="t display">
            {copy.faqTitleLead} <span className="it">{copy.faqTitleItalic}</span>
          </h2>
        </div>
        <div>
          {copy.faq.map((item, index) => (
            <details className="q" key={item.question} open={index === 0}>
              <summary>
                <span className="serif">{item.question}</span>
                <svg
                  aria-hidden="true"
                  className="pl"
                  fill="none"
                  height="20"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.6"
                  viewBox="0 0 24 24"
                  width="20"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function closingSection() {
  return (
    <section className="close">
      <div className="wrap close-wrap">
        <h2 className="serif close-h2">
          {copy.closingTitleLead} <span className="it">{copy.closingTitleItalic}</span>
        </h2>
        <p>{copy.closingLede}</p>
        <div className="close-actions">
          <a className="btn" href="/signin">
            {marketingCopy.cta.startTrial}
          </a>
          <a className="btn2" href="/signin">
            {copy.closingSignIn}
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * The public landing at `/`, prerendered to static HTML by `scripts/prerender.tsx`.
 *
 * @returns The landing page element.
 */
export function LandingPage() {
  return (
    <MarketingPage scope="landing">
      <MarketingLandingHero />
      <MarketingLandingFlow />
      <MarketingLandingReplies />
      <MarketingLandingBand />
      {controlSection()}
      {boardStages()}
      {failureSection()}
      {pricingSection()}
      {faqSection()}
      {closingSection()}
    </MarketingPage>
  );
}
