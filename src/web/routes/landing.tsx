import type { ReactNode } from "react";

import { ButtonLink } from "../components/button-link.tsx";
import { MarketingEyebrow } from "../components/marketing-eyebrow.tsx";
import { ThemeToggle } from "../components/theme-toggle.tsx";
import { PUBLIC_ATS } from "../../shared/plans.ts";
import { marketingCopy } from "../../shared/marketing-copy.ts";

const copy = marketingCopy.landing;
const { pricing } = marketingCopy;

const text = {
  navQuestions: "Questions",
  nowChecking: "Next check 12:00",
  newPostings: "New postings",
  screeningScore: "91",
  screeningRole: "Platform Engineer",
  screeningCompany: "Northwind Labs",
  mailNorthwindTime: "09:12",
  mailFerroTime: "11:48",
  rejectedTag: "Rejected",
  faqOpen: "+",
  letterEnd: ",",
  discoveryNumeral: "I.",
  discoveryName: "Discovery",
  discoveryBody:
    "Overture checks the five hiring systems for fresh postings matching your titles, locations, and salary floor.",
  screeningBody:
    "Each role is scored against your resume with plain reasons. Postings below your bar are passed over before any form opens.",
  remoteInCanada: "Remote in Canada",
  preparationBody:
    "Application questions are filled strictly from your resume and your Facts. Nothing is guessed or fabricated.",
  reviewBody:
    "Anything uncertain opens a Review. Answer once and every application waiting on that question moves forward.",
  holdLabel: "Review · needs you",
  holdQuestion: "Are you authorized to work in the US?",
  holdUnblocks: "Unblocks 4 applications",
  holdAnswer: "Answer once",
  overtureBody:
    "A tailored cover letter is drafted for the role while your resume PDF is attached unchanged. Nothing is sent until you approve it.",
  letterOpen: "Dear hiring team at",
  letterCompany: "Northwind Labs",
  letterBody:
    "Six years of running Kubernetes platforms is why the Platform Engineer role caught my eye. I would bring the same care to your…",
  resumeChip: "Resume.pdf · sent unchanged",
  returnNumeral: "VI.",
  returnName: "What comes back",
  returnBody:
    "Every submitted application lands on your Board with a full record. Recruiter replies advance the card automatically.",
  howTitleA: "How it",
  howTitleB: "works",
  howLede:
    "One application, from fresh posting to recruiter reply. Set your criteria once and inspect every step.",
  appliesHeadingA: "Applies where companies actually",
  appliesHeadingB: "hire.",
  appliesLede: "Direct from company career pages. No aggregators, no stale listings.",
  directSubmission: "Direct submission",
  repliesTitleA: "Every reply,",
  repliesTitleB: "read and sorted.",
  repliesLede:
    "Forward recruiter mail from ATS senders to Overture with one filter. Overture classifies each reply and updates the matching card on your Board.",
  forwardedMail: "Forwarded mail",
  readOnly: "read-only",
  mailNorthwindFrom: "Northwind Labs · Recruiting",
  mailNorthwindSubject: "Next steps for the Platform Engineer role",
  mailNorthwindBody:
    "Hi Maya, thanks for applying. We would like to set up a 30 minute call this week to talk through the role…",
  mailNorthwindTag: "Interview request",
  mailFerroFrom: "Ferro Cloud · Recruiting",
  mailFerroSubject: "Update on your application",
  mailFerroBody:
    "Thank you for your interest in the DevOps Engineer role. After review we have decided to move forward with other candidates…",
  mailFerroTag: "Rejection",
  repliesNote: "Moved to Interviewing · 2 min ago",
  repliesTrust:
    "Overture never reads your personal mailbox and never sends email from your account.",
  controlEyebrow: "Control and honesty",
  controlTitleA: "Built on",
  controlTitleB: "your facts.",
  controlLede:
    "Three rules govern every application Overture prepares. Nothing goes out behind your back.",
  recommended: "Recommended",
  faqTitle: "Questions",
  closingTitleA: "Let Overture handle the",
  closingTitleB: "applying.",
  closingBody:
    "Upload your resume once. Overture finds fresh roles, prepares each application from your facts, and asks before it guesses.",
  copyright: "© 2026 Overture",
  faqItems: [
    {
      question: "Does Overture edit my resume?",
      answer:
        "No. Your resume PDF is sent unchanged with every application. Only the cover letter adapts to each role.",
    },
    {
      question: "Do I approve each application?",
      answer:
        "Yes. Every application is shown as Ready to send, and nothing goes out until you approve it.",
    },
    {
      question: "What happens when it's unsure about an answer?",
      answer:
        "The application opens a Review instead of guessing. Answer once, it saves to your Facts, and every waiting application moves forward.",
    },
    {
      question: "Can I see what was submitted?",
      answer:
        "Yes. Every card on your Board opens a dossier with a dated Timeline, all form answers and their sources, the cover letter, the resume PDF, and recruiter emails.",
    },
    {
      question: "Which job sites does it check?",
      answer: `Company career pages running ${PUBLIC_ATS.slice(0, -1).join(", ")} and ${PUBLIC_ATS.at(-1) ?? ""}. Direct sources only, no aggregators or stale listings.`,
    },
    {
      question: "Is there a daily limit?",
      answer:
        "Yes. Each plan sets how many applications it includes, and sends are limited to daytime hours.",
    },
    {
      question: "Can I pause it?",
      answer: "Yes. Pause or resume from Home at any time. Nothing is sent while it is paused.",
    },
  ],
  controls: [
    {
      number: "01",
      title: "Every answer traces to your facts",
      body: "Your Facts store each reusable answer with its exact source: your resume or a reply you saved once.",
      proof: "Facts · source linked",
    },
    {
      number: "02",
      title: "Nothing uncertain gets sent",
      body: "When a form asks something missing from your profile, Overture opens a Review until you answer.",
      proof: "Reviews · answer once, reuse everywhere",
    },
    {
      number: "03",
      title: "See exactly what was submitted",
      body: "Every application keeps a dated Timeline of discovery, scoring, answers, cover letter, and unchanged resume PDF.",
      proof: "Timeline · complete dossier",
    },
  ],
  newPostingRows: [
    ["Platform Engineer", "Northwind Labs · Toronto, ON", "fresh"],
    ["DevOps Engineer", "Ferro Cloud · Remote, Canada", "fresh"],
    ["Senior Backend Engineer", "Halden Systems · Ottawa, ON", "fresh"],
    ["Platform Engineer", "Larkspur Health · Vancouver, BC", "passed"],
  ],
  preparationRows: [
    ["Years of Kubernetes experience", "6 years", "From your resume"],
    ["Authorized to work in Canada?", "Yes", "From your Facts"],
  ],
  boardColumns: [
    { title: "Applied", count: "3", cards: [["Ferro Cloud", "DevOps Engineer"]] },
    { title: "Screening", count: "2", cards: [["Larkspur Health", "Platform Engineer"]] },
    {
      title: "Interviewing",
      count: "2",
      cards: [
        ["Northwind Labs", "Staff Platform Engineer"],
        ["Quill & Ash", "Backend Engineer"],
      ],
    },
    {
      title: "Offer",
      count: "1",
      cards: [
        ["Tessel Bio", "Data Platform Engineer"],
        ["Corva Maps", "Infrastructure Engineer"],
      ],
    },
  ],
} as const;

const wrap = "mx-auto w-full max-w-[1200px] px-[clamp(20px,4vw,48px)] min-[1700px]:max-w-[1440px]";

const sectionTitle =
  "font-serif text-[clamp(40px,4.6vw,64px)] leading-[1.02] tracking-[-0.015em] text-balance";

const card =
  "rounded-[10px] border border-border bg-card shadow-[0_1px_0_rgba(21,19,17,.08),0_12px_24px_-18px_rgba(21,19,17,.38)]";

const well = "rounded-lg border border-border bg-muted";

const navLink =
  "inline-flex min-h-[44px] items-center whitespace-nowrap text-[15px] text-muted-foreground hover:text-foreground focus-visible:underline";

const tile =
  "flex h-[84px] items-center justify-center rounded-[10px] border border-background/40 px-4 text-center font-sans text-[15px] font-semibold tracking-[-0.02em] text-background";

const eyebrowLabel =
  "font-sans text-[10.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground";

/**
 * The public landing at `/`, prerendered to static HTML by `scripts/prerender.tsx`.
 * It follows the Landing board: hero, how it works, where it applies, replies, control, pricing,
 * questions and the close. The animated boards are rendered at their static final frame.
 *
 * @returns The landing page element.
 */
export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {renderLandingHeader()}
      <main className="flex-1 outline-none" id="main-content" tabIndex={-1}>
        {renderHero()}
        {renderHowItWorks()}
        {renderWhereItApplies()}
        {renderReplies()}
        {renderControl()}
        {renderPricing()}
        {renderQuestions()}
        {renderClosing()}
      </main>
      {renderLandingFooter()}
    </div>
  );
}

function renderLandingHeader() {
  return (
    <header className="border-b border-border">
      <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-4`}>
        <a
          aria-label={`${marketingCopy.brand}, home`}
          className="font-serif text-[29px] leading-none tracking-[-0.01em]"
          href="/"
        >
          {marketingCopy.brand}
        </a>
        <nav
          aria-label={marketingCopy.nav.primaryLabel}
          className="hidden flex-wrap items-center gap-x-[30px] min-[861px]:flex"
        >
          <a className={navLink} href="#how-it-works">
            {marketingCopy.nav.howItWorks}
          </a>
          <a className={navLink} href="#where-it-applies">
            {marketingCopy.nav.whereItApplies}
          </a>
          <a className={navLink} href="/pricing">
            {marketingCopy.nav.pricing}
          </a>
          <a className={navLink} href="#questions">
            {text.navQuestions}
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <a className={`${navLink} font-semibold min-[861px]:hidden`} href="/pricing">
            {marketingCopy.nav.pricing}
          </a>
          <a
            className="inline-flex min-h-[44px] items-center rounded-md border border-foreground px-5 text-[14px] font-semibold text-foreground hover:bg-muted"
            href="/signin"
          >
            {marketingCopy.nav.signIn}
          </a>
          <span aria-hidden="true" className="hidden h-7 w-px bg-input min-[861px]:block" />
          <a
            className="hidden min-h-[44px] items-center rounded-md bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-btn-hover min-[861px]:inline-flex"
            href="/signin"
          >
            {marketingCopy.cta.startTrial}
          </a>
          <ThemeToggle className="inline-flex size-11 items-center justify-center rounded-lg border border-input text-foreground hover:bg-muted" />
        </div>
      </div>
    </header>
  );
}

function renderHero() {
  const [front, ...behind] = copy.previewRows;

  return (
    <section
      className={`${wrap} grid items-center gap-14 pt-14 pb-24 max-md:pt-6 max-md:pb-10 md:grid-cols-2 md:gap-16`}
    >
      <div>
        <MarketingEyebrow>{copy.eyebrow}</MarketingEyebrow>
        <h1 className="mt-6 font-serif text-[clamp(44px,5.4vw,80px)] leading-[0.98] tracking-[-0.02em] max-md:text-[44px]">
          {copy.headline}
        </h1>
        <p className="mt-7 max-w-[520px] text-[18px] leading-[1.55] text-muted-foreground max-md:mt-4 max-md:text-[16px]">
          {copy.lede}
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          <ButtonLink href="/signin" variant="primary">
            {marketingCopy.cta.startTrial}
          </ButtonLink>
          <ButtonLink href="/pricing" variant="secondary">
            {marketingCopy.cta.seePlans}
          </ButtonLink>
        </div>
        <p className="mt-5 font-mono text-[12px] leading-[1.7] text-muted-foreground">
          {copy.trialNote}
        </p>
      </div>

      <div className="relative mx-auto h-[360px] w-full max-w-[540px] md:h-[444px]">
        <div
          aria-hidden="true"
          className="absolute inset-x-6 top-10 h-[360px] rotate-[2deg] rounded-xl border border-border bg-card opacity-70"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-3 top-16 h-[360px] -rotate-[2.5deg] rounded-xl border border-border bg-card opacity-50"
        />
        <aside aria-label={copy.previewStatus} className={`${card} relative rounded-xl p-5 md:p-6`}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[12px] tracking-[0.12em] text-ok uppercase">
              {copy.previewStatus}
            </span>
            <span className="font-mono text-[12px] text-muted-foreground">{copy.previewVia}</span>
          </div>
          <p className="mt-3 font-serif text-[30px] leading-tight">{copy.previewRole}</p>
          <p className="text-[15px] text-muted-foreground">{copy.previewCompany}</p>
          <dl className="mt-4 divide-y divide-border border-y border-border text-[14px]">
            {[front, ...behind].map(([label, value]) => (
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
      </div>
    </section>
  );
}

function renderHowItWorks() {
  return (
    <section className={`${wrap} py-24`} id="how-it-works">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
        <h2 className={`${sectionTitle} max-w-[640px]`}>
          {text.howTitleA} <span className="italic">{text.howTitleB}</span>
        </h2>
        <p className="max-w-[400px] text-muted-foreground text-pretty">{text.howLede}</p>
      </div>

      <ol className="mt-12 grid gap-8 md:grid-cols-3">
        {copy.steps.map((step) => (
          <li className="border-t border-input pt-5" key={step.label}>
            <p className="font-mono text-[13px] text-muted-foreground">{step.label}</p>
            <h3 className="mt-2 font-serif text-[30px] leading-[1.15]">{step.title}</h3>
            <p className="mt-2.5 text-[15px] leading-[1.6] text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-16 grid gap-6 md:grid-cols-12">
        {renderDiscoveryCard()}
        {renderStep({
          body: text.screeningBody,
          className: "md:col-span-5",
          name: "Screening",
          numeral: "II.",
          visual: renderScreeningVisual(),
        })}
        {renderStep({
          body: text.preparationBody,
          className: "md:col-span-5",
          name: "Preparation",
          numeral: "III.",
          visual: renderPreparationVisual(),
        })}
        {renderStep({
          body: text.reviewBody,
          className: "md:col-span-5",
          name: "Review",
          numeral: "IV.",
          visual: renderReviewVisual(),
        })}
        {renderStep({
          body: text.overtureBody,
          className: "md:col-span-7",
          name: "Overture",
          numeral: "V.",
          visual: renderLetterVisual(),
        })}
        {renderReturnCard()}
      </div>
    </section>
  );
}

function renderDiscoveryCard() {
  return (
    <article className={`${card} flex flex-col gap-6 p-[22px] md:col-span-7 md:row-span-2`}>
      <div className={`${well} flex flex-1 flex-col justify-center gap-3.5 p-[18px]`}>
        <div className="flex items-center justify-between gap-2.5">
          <span className={eyebrowLabel}>{text.newPostings}</span>
          <span className="font-mono text-[12.5px]">{text.nowChecking}</span>
        </div>
        {text.newPostingRows.map(([title, meta, state]) => (
          <div
            className={`${card} flex items-center gap-3.5 px-[18px] py-3.5 ${state === "passed" ? "border-dashed bg-background shadow-none" : ""}`}
            key={title + meta}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif text-[22px] leading-[1.1]">{title}</p>
              <p className="truncate text-[13px] text-muted-foreground">{meta}</p>
            </div>
            <span
              className={`size-2 rounded-full bg-signal ${state === "passed" ? "invisible" : ""}`}
            />
          </div>
        ))}
      </div>
      <div>
        <h3 className="font-serif text-[42px] leading-[1.1]">
          {text.discoveryNumeral} <span className="italic">{text.discoveryName}</span>
        </h3>
        <p className="mt-2 max-w-[520px] text-[14px] text-muted-foreground text-pretty">
          {text.discoveryBody}
        </p>
      </div>
    </article>
  );
}

function renderScreeningVisual() {
  return (
    <div className={`${well} flex items-center justify-center p-[18px]`}>
      <div className={`${card} w-full max-w-[400px] p-5`}>
        <div className="flex items-center gap-[18px]">
          <span className="flex size-[74px] items-center justify-center rounded-full border-[3px] border-signal font-serif text-[27px] italic">
            {text.screeningScore}
          </span>
          <div className="min-w-0">
            <p className="font-serif text-[22px] leading-[1.1]">{text.screeningRole}</p>
            <p className="text-[13px] text-muted-foreground">{text.screeningCompany}</p>
          </div>
        </div>
        <p className="mt-4 border-t border-border pt-4 text-[14px]">{text.remoteInCanada}</p>
      </div>
    </div>
  );
}

function renderPreparationVisual() {
  return (
    <div className={`${well} flex items-center justify-center p-[18px]`}>
      <div className="flex w-full max-w-[400px] flex-col gap-3">
        {text.preparationRows.map(([question, answer, source]) => (
          <div className={`${card} px-4 py-3.5`} key={question}>
            <p className="text-[13px] text-muted-foreground">{question}</p>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2.5">
              <span className="font-serif text-[30px] leading-[1.05]">{answer}</span>
              <span className="rounded-full border border-foreground px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap">
                {source}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderReviewVisual() {
  return (
    <div className={`${well} flex items-center justify-center p-[18px]`}>
      <div className={`${card} w-full max-w-[420px] p-5`}>
        <span className="inline-flex rounded-full bg-need-soft px-2.5 py-0.5 text-[12px] font-semibold text-need">
          {text.holdLabel}
        </span>
        <p className="mt-3 font-serif text-[28px] leading-[1.12]">{text.holdQuestion}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 border-t border-border pt-3.5">
          <b className="text-[13.5px] font-bold">{text.holdUnblocks}</b>
          <span className="inline-flex min-h-9 items-center rounded-md bg-foreground px-4 text-[13px] font-semibold text-background">
            {text.holdAnswer}
          </span>
        </div>
      </div>
    </div>
  );
}

function renderLetterVisual() {
  return (
    <div className={`${well} flex items-center justify-center p-[18px]`}>
      <div className="flex w-full max-w-[480px] flex-col gap-3">
        <div className={`${card} px-6 py-5`}>
          <p className="font-serif text-[19px] leading-[1.45]">
            {text.letterOpen}{" "}
            <span className="rounded-[3px] bg-signal-soft px-1 text-signal-text">
              {text.letterCompany}
            </span>
            {text.letterEnd}
          </p>
          <p className="mt-2 font-serif text-[19px] leading-[1.45] text-muted-foreground">
            {text.letterBody}
          </p>
        </div>
        <span className="inline-flex h-[30px] items-center self-start rounded-full border border-foreground px-3 text-[12px] font-semibold">
          {text.resumeChip}
        </span>
      </div>
    </div>
  );
}

function renderStep({
  body,
  className,
  name,
  numeral,
  visual,
}: {
  body: string;
  className: string;
  name: string;
  numeral: string;
  visual: ReactNode;
}) {
  return (
    <article className={`${card} flex flex-col gap-5 p-[22px] ${className}`}>
      {visual}
      <div>
        <h3 className="font-serif text-[42px] leading-[1.1]">
          {numeral} <span className="italic">{name}</span>
        </h3>
        <p className="mt-2 text-[14px] text-muted-foreground text-pretty">{body}</p>
      </div>
    </article>
  );
}

function renderReturnCard() {
  return (
    <article
      className={`${card} flex flex-col gap-6 p-[22px] md:col-span-12 md:flex-row md:items-stretch`}
    >
      <div className="flex flex-col justify-end md:w-[340px] md:flex-none">
        <h3 className="font-serif text-[42px] leading-[1.1]">
          {text.returnNumeral} <span className="italic">{text.returnName}</span>
        </h3>
        <p className="mt-2 text-[14px] text-muted-foreground text-pretty">{text.returnBody}</p>
      </div>
      <div className={`${well} flex-1 p-[18px]`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {text.boardColumns.map((column) => (
            <div className="flex min-w-0 flex-col gap-2.5" key={column.title}>
              <div className="flex items-baseline justify-between border-t-[3px] border-foreground pt-2">
                <span className="font-serif text-[21px] leading-[1.1]">{column.title}</span>
                <span className="font-serif text-[15px] italic text-muted-foreground">
                  {column.count}
                </span>
              </div>
              {column.cards.map(([company, role]) => (
                <div className={`${card} flex min-w-0 flex-col gap-px px-2.5 py-2`} key={company}>
                  <span className="truncate text-[12px] font-semibold">{company}</span>
                  <span className="truncate font-serif text-[15px]">{role}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function renderWhereItApplies() {
  const top = PUBLIC_ATS.slice(0, 3);
  const bottom = PUBLIC_ATS.slice(3);

  return (
    <section className="bg-foreground text-background" id="where-it-applies">
      <div className={`${wrap} pt-28`}>
        <p className="font-mono text-[12px] tracking-[0.12em] text-background uppercase md:text-[13px]">
          {copy.atsEyebrow}
        </p>
        <div className="mt-5 grid gap-x-16 gap-y-6 lg:grid-cols-2 lg:items-end">
          <h2 className="max-w-[760px] font-serif text-[clamp(34px,5vw,72px)] leading-[0.98] tracking-[-0.02em] text-balance">
            {text.appliesHeadingA} <span className="italic">{text.appliesHeadingB}</span>
          </h2>
          <p className="text-[16.5px] lg:justify-self-end lg:max-w-[430px]">{text.appliesLede}</p>
        </div>
      </div>
      <div className={`${wrap} pt-14 pb-28`}>
        <p className="font-sans text-[12px] font-semibold tracking-[0.14em] uppercase">
          {text.directSubmission}
        </p>
        <h3 className="mt-2 font-serif text-[30px] leading-[1.1]">{copy.atsTitle}</h3>
        <p className="mt-1.5 text-[14.5px]">{copy.atsNote}</p>
        <div className="mx-auto mt-12 grid max-w-[900px] grid-cols-3 gap-x-8 gap-y-6">
          {top.map((name) => (
            <div className={tile} key={name}>
              {name}
            </div>
          ))}
          <div className="col-span-3 flex flex-col items-center gap-2 py-2">
            <span aria-hidden="true" className="h-8 w-px bg-background/40" />
            <span className="rounded-[10px] border border-background/40 px-7 py-3.5 font-serif text-[30px] italic">
              {marketingCopy.brand}
            </span>
            <span aria-hidden="true" className="h-8 w-px bg-background/40" />
          </div>
          <div className="col-span-3 grid grid-cols-2 gap-x-8 gap-y-6">
            {bottom.map((name) => (
              <div className={tile} key={name}>
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function renderReplies() {
  return (
    <section className={`${wrap} py-24`}>
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
        <h2 className={`${sectionTitle} max-w-[700px]`}>
          {text.repliesTitleA} <span className="italic">{text.repliesTitleB}</span>
        </h2>
        <p className="max-w-[420px] text-muted-foreground text-pretty">{text.repliesLede}</p>
      </div>

      <div className="mt-11 grid items-center gap-5 md:grid-cols-[minmax(0,5fr)_44px_minmax(0,7fr)]">
        {renderInboxCard()}
        <div
          aria-hidden="true"
          className="flex justify-center text-muted-foreground max-md:h-7 max-md:rotate-90"
        >
          <svg
            fill="none"
            height="22"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            width="22"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </div>
        {renderBoardMini()}
      </div>
      <p className="mt-7 text-[13.5px] text-muted-foreground">{text.repliesTrust}</p>
    </section>
  );
}

function renderInboxCard() {
  return (
    <div className={`${card} p-[18px_22px_22px]`}>
      <div className="flex items-center justify-between border-b border-border pb-3">
        <span className={eyebrowLabel}>{text.forwardedMail}</span>
        <span className="font-mono text-[11.5px] text-muted-foreground">{text.readOnly}</span>
      </div>
      <div className="mt-4 flex flex-col gap-5">
        <div>
          <p className="text-[14px] font-semibold">{text.mailNorthwindFrom}</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
            {text.mailNorthwindTime}
          </p>
          <p className="mt-3 text-[15.5px] font-semibold">{text.mailNorthwindSubject}</p>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{text.mailNorthwindBody}</p>
          <span className="mt-3 inline-flex items-center rounded-full bg-signal-soft px-3 py-1 text-[12px] font-semibold text-signal-text">
            {text.mailNorthwindTag}
          </span>
        </div>
        <div className="border-t border-border pt-5">
          <p className="text-[14px] font-semibold">{text.mailFerroFrom}</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
            {text.mailFerroTime}
          </p>
          <p className="mt-3 text-[15.5px] font-semibold">{text.mailFerroSubject}</p>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{text.mailFerroBody}</p>
          <span className="mt-3 inline-flex items-center rounded-full bg-muted px-3 py-1 text-[12px] font-semibold">
            {text.mailFerroTag}
          </span>
        </div>
      </div>
    </div>
  );
}

function renderBoardMini() {
  return (
    <div className={`${card} bg-muted p-4`}>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {["Applied", "Screening", "Interviewing", "Closed"].map((column) => (
          <div
            className="border-t-[3px] border-foreground pt-2 font-serif text-[18px] leading-[1.1]"
            key={column}
          >
            {column}
          </div>
        ))}
        {renderMiniCard({
          company: "Halden Systems",
          role: "Senior Backend Eng.",
          className: "md:col-start-1",
        })}
        {renderMiniCard({
          company: "Northwind Labs",
          role: "Platform Engineer",
          className: "border-foreground md:col-start-3",
        })}
        {renderMiniCard({
          company: "Corva Maps",
          role: "Infrastructure Eng.",
          className: "border-foreground md:col-start-4",
        })}
        {renderMiniCard({
          company: "Ferro Cloud",
          role: "DevOps Engineer",
          className: "border-foreground md:col-start-4",
          tag: (
            <span className="mt-1 inline-flex w-fit rounded-full bg-need-soft px-2 text-[10px] font-semibold tracking-[0.08em] text-need uppercase">
              {text.rejectedTag}
            </span>
          ),
        })}
      </div>
      <p className="mt-3 text-[13px] font-medium text-muted-foreground">{text.repliesNote}</p>
    </div>
  );
}

function renderMiniCard({
  className,
  company,
  role,
  tag,
}: {
  className: string;
  company: string;
  role: string;
  tag?: ReactNode;
}) {
  return (
    <div className={`${card} flex flex-col px-2.5 py-2 ${className}`}>
      <span className="block text-[12px] font-semibold">{company}</span>
      <span className="block truncate font-serif text-[15px]">{role}</span>
      {tag}
    </div>
  );
}

function renderControl() {
  return (
    <section className={`${wrap} py-24`} id="control">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
        <div>
          <MarketingEyebrow>{text.controlEyebrow}</MarketingEyebrow>
          <h2 className={`${sectionTitle} mt-3 max-w-[640px]`}>
            {text.controlTitleA} <span className="italic">{text.controlTitleB}</span>
          </h2>
        </div>
        <p className="max-w-[400px] text-muted-foreground text-pretty">{text.controlLede}</p>
      </div>
      <div className="mt-11 grid gap-5 md:grid-cols-3">
        {text.controls.map((item) => (
          <article className={`${card} flex flex-col gap-3 p-6`} key={item.number}>
            <span className="font-serif text-[22px] italic text-muted-foreground">
              {item.number}
            </span>
            <h3 className="font-serif text-[28px] leading-[1.12] text-balance">{item.title}</h3>
            <p className="text-[14px] text-muted-foreground text-pretty">{item.body}</p>
            <div className="mt-auto border-t border-border pt-3.5 text-[12px] font-semibold">
              {item.proof}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function renderPricing() {
  const plans = [
    {
      ...pricing.trial,
      cta: marketingCopy.cta.startTrial,
      featured: false,
      key: "trial",
      note: "",
    },
    {
      ...pricing.week,
      cta: marketingCopy.cta.chooseWeek,
      featured: false,
      key: "week",
      note: pricing.week.priceNote,
    },
    {
      ...pricing.month,
      cta: marketingCopy.cta.chooseMonth,
      featured: true,
      key: "month",
      note: pricing.month.priceNote,
    },
  ];

  return (
    <section className="border-y border-border bg-muted" id="pricing">
      <div className={`${wrap} py-24`}>
        <div className="mx-auto max-w-[680px] text-center">
          <h2 className={sectionTitle}>{pricing.headline}</h2>
          <p className="mt-4 text-muted-foreground text-pretty">{pricing.lede}</p>
        </div>
        <div className="mt-13 grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <article
              className={`${card} flex flex-col p-8 ${plan.featured ? "border-foreground" : ""}`}
              key={plan.key}
            >
              <div className="flex items-center justify-between gap-2.5">
                <h3 className="font-serif text-[36px] leading-none">{plan.name}</h3>
                {plan.featured ? (
                  <span className="rounded-full bg-foreground px-3 py-1 text-[11.5px] font-semibold text-background">
                    {text.recommended}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[14px] text-muted-foreground">{plan.allowance}</p>
              <p className="mt-5 flex items-baseline gap-2 font-serif text-[58px] leading-none italic">
                {plan.price}
                <span className="font-sans text-[16px] text-muted-foreground not-italic">
                  {plan.note}
                </span>
              </p>
              <hr className="mt-5 border-t border-border" />
              <ul className="mt-5 mb-7 flex flex-col gap-3 text-[14px]">
                {plan.bullets.map((bullet) => (
                  <li className="flex gap-2.5" key={bullet}>
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-signal"
                    />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <ButtonLink href="/signin" variant={plan.featured ? "primary" : "secondary"}>
                  {plan.cta}
                </ButtonLink>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-10 text-center font-serif text-[30px] leading-tight">
          {copy.failureTitle}
        </p>
        <p className="mx-auto mt-3 max-w-[760px] text-center text-muted-foreground text-pretty">
          {copy.failureBody}
        </p>
      </div>
    </section>
  );
}

function renderQuestions() {
  return (
    <section
      className={`${wrap} grid gap-10 py-24 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-20`}
      id="questions"
    >
      <h2 className={sectionTitle}>{text.faqTitle}</h2>
      <div>
        {text.faqItems.map((faq, index) => (
          <details className="group border-t border-border" key={faq.question} open={index === 0}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 py-6 [&::-webkit-details-marker]:hidden">
              <span className="font-serif text-[27px] leading-[1.15]">{faq.question}</span>
              <span
                aria-hidden="true"
                className="text-[24px] transition-transform group-open:rotate-45"
              >
                {text.faqOpen}
              </span>
            </summary>
            <p className="pr-10 pb-6 text-muted-foreground text-pretty">{faq.answer}</p>
          </details>
        ))}
        <div className="border-t border-border" />
      </div>
    </section>
  );
}

function renderClosing() {
  return (
    <section className="border-t border-border">
      <div className={`${wrap} flex flex-col items-center gap-6 py-24 text-center`}>
        <h2 className="max-w-[820px] font-serif text-[clamp(44px,5.6vw,80px)] leading-none tracking-[-0.02em] text-balance">
          {text.closingTitleA} <span className="italic">{text.closingTitleB}</span>
        </h2>
        <p className="max-w-[460px] text-muted-foreground">{text.closingBody}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/signin" variant="primary">
            {marketingCopy.cta.startTrial}
          </ButtonLink>
          <ButtonLink href="/signin" variant="secondary">
            {marketingCopy.nav.signIn}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

function renderLandingFooter() {
  return (
    <footer className="border-t border-border text-muted-foreground">
      <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-12 gap-y-5 py-8`}>
        <span className="font-serif text-[25px] text-foreground">{marketingCopy.brand}</span>
        <nav
          aria-label={marketingCopy.footer.navLabel}
          className="grid grid-cols-2 gap-x-6 gap-y-1 min-[480px]:flex min-[480px]:flex-wrap min-[480px]:gap-x-7"
        >
          <a className={navLink} href="/pricing">
            {marketingCopy.nav.pricing}
          </a>
          <a className={navLink} href="#questions">
            {text.navQuestions}
          </a>
          <a className={navLink} href="/privacy">
            {marketingCopy.footer.privacy}
          </a>
          <a className={navLink} href="/terms">
            {marketingCopy.footer.terms}
          </a>
        </nav>
      </div>
      <div className={`${wrap} pb-8 text-[12.5px]`}>
        <span>{text.copyright}</span>
      </div>
    </footer>
  );
}
