import { formatUsd, PLANS, PUBLIC_ATS, SEND_RULES, TRIAL } from "./plans.ts";

const countWords = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];
const atsList = `${PUBLIC_ATS.slice(0, -1).join(", ")} and ${PUBLIC_ATS.at(-1) ?? ""}`;

export const marketingCopy = {
  brand: "Overture",
  nav: {
    howItWorks: "How it works",
    whereItApplies: "Where it applies",
    pricing: "Pricing",
    signIn: "Sign in",
    primaryLabel: "Main",
  },
  footer: {
    terms: "Terms",
    privacy: "Privacy",
    pricing: "Pricing",
    navLabel: "Footer",
    tagline: "Prepares every application. Sends when you approve.",
  },
  cta: {
    startTrial: "Start the trial",
    seePlans: "See the plans",
    chooseWeek: "Choose Week",
    chooseMonth: "Choose Month",
  },
  landing: {
    eyebrow: "For one person's job search",
    headline: "Overture prepares every application. It sends only when you approve.",
    lede: "It matches Postings to your Targets, fills each application from your saved answers and resume, and shows every answer before anything is sent.",
    trialNote: `Verify a card to start. The trial is ${String(TRIAL.applications)} applications, once per card.`,
    previewStatus: "Ready to send",
    previewVia: "on their careers page",
    previewRole: "Product Designer",
    previewCompany: "Halden Systems · Remote, UK",
    previewRows: [
      ["Work authorisation", "Yes, from your saved answers"],
      ["Notice period", "Two weeks, from your saved answers"],
      ["Resume", "Resume v3, unchanged"],
    ] as const,
    previewSend: "Send",
    previewSkip: "Skip",
    atsEyebrow: "Where it applies",
    atsTitle: `${countWords[PUBLIC_ATS.length] ?? String(PUBLIC_ATS.length)} applicant tracking systems`,
    atsNote:
      "Overture reads each posting's own form and fills it. No other system is supported yet.",
    howEyebrow: "How it works",
    steps: [
      {
        label: "Step 1",
        title: "Set your Targets",
        body: "The roles and places you want. Overture matches every job against them.",
      },
      {
        label: "Step 2",
        title: "Review what is Ready",
        body: "Each Application is prepared with every answer, the resume and a cover letter where one is asked. You see the source of every answer.",
      },
      {
        label: "Step 3",
        title: "Approve the ones you want",
        body: `Send goes out as soon as you approve, about ${String(SEND_RULES.paidGapMinutes)} minutes apart for paid sends. Undo until sending starts.`,
      },
    ],
    boardTitle: "Each application moves across the Board",
    boardLede:
      "The Board shows where every application stands with the employer, from Queued to Closed.",
    stages: [
      { title: "Queued", body: "Being prepared, or waiting on a Review." },
      { title: "Applied", body: "Sent to the employer, and confirmed." },
      { title: "Screening", body: "The employer has replied." },
    ],
    failureTitle: "Never charged for failure",
    failureBody:
      "An Application that can't be sent, or whose sending can't be confirmed, is marked Couldn't apply and never uses one of your applications. Only an Application confirmed sent counts against your plan. Applications left is always on Home.",
    closingTitle: `Start with ${String(TRIAL.applications)} applications.`,
  },
  pricing: {
    eyebrow: "Plans",
    headline: "Pay for applications sent.",
    lede: "Overture prepares every application and sends it when you approve. Each plan gives you a number of applications over a set period.",
    trial: {
      eyebrow: "Card verified once",
      name: "Trial",
      price: "Card verified",
      allowance: `${String(TRIAL.applications)} applications`,
      allowanceNote: "Once per card",
      bullets: [
        "Verify a card to start",
        `${String(TRIAL.applications)} applications, once per card`,
        "Upgrade at any time",
      ],
    },
    week: {
      eyebrow: `Renews every ${String(PLANS.week.periodDays)} days`,
      name: "Week",
      price: formatUsd(PLANS.week.priceUsd),
      priceNote: `/ over ${String(PLANS.week.periodDays)} days`,
      allowance: `${String(PLANS.week.applications)} applications`,
      allowanceNote: `Over ${String(PLANS.week.periodDays)} days`,
      bullets: [
        `${formatUsd(PLANS.week.priceUsd)} for ${String(PLANS.week.applications)} applications over ${String(PLANS.week.periodDays)} days`,
        "Unused applications expire; no rollover",
        "Switch to Month at renewal",
      ],
    },
    month: {
      eyebrow: `Renews every ${String(PLANS.month.periodDays)} days`,
      name: "Month",
      price: formatUsd(PLANS.month.priceUsd),
      priceNote: `/ over ${String(PLANS.month.periodDays)} days`,
      allowance: `${String(PLANS.month.applications)} applications`,
      allowanceNote: `Over ${String(PLANS.month.periodDays)} days`,
      bullets: [
        `${formatUsd(PLANS.month.priceUsd)} for ${String(PLANS.month.applications)} applications over ${String(PLANS.month.periodDays)} days`,
        "Unused applications expire; no rollover",
        "Cancel at the end of the period",
      ],
    },
    failureTitle: "Never charged for failure",
    failureBody:
      "An Application that can't be sent, or whose sending can't be confirmed, is marked Couldn't apply and never uses one of your applications. Only an Application confirmed sent counts against your plan. Applications left is always on Home.",
    includesTitle: "Every plan includes",
    includes: [
      `Every application is shown to you as Ready to send before anything is sent.`,
      `Sends go out as soon as you approve, about ${String(SEND_RULES.paidGapMinutes)} minutes apart for paid sends, up to ${String(SEND_RULES.maxPerDay)} a day.`,
      `One company per ${String(PLANS.month.periodDays)} days.`,
      `${atsList}.`,
    ],
  },
} as const;
