import { formatHour, formatUsd, PLANS, PUBLIC_ATS, SEND_WINDOW, TRIAL } from "./plans.ts";

const countWords = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];
const sendHours = `${formatHour(SEND_WINDOW.startHour)} to ${formatHour(SEND_WINDOW.endHour)}`;
const atsList = `${PUBLIC_ATS.slice(0, -1).join(", ")} and ${PUBLIC_ATS.at(-1) ?? ""}`;
const atsCount = countWords[PUBLIC_ATS.length] ?? String(PUBLIC_ATS.length);

const railTicks = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"] as const;

export const marketingCopy = {
  brand: "Overture",
  nav: {
    howItWorks: "How it works",
    whereItApplies: "Where it applies",
    pricing: "Pricing",
    questions: "Questions",
    signIn: "Sign in",
    primaryLabel: "Main",
  },
  footer: {
    terms: "Terms",
    privacy: "Privacy",
    pricing: "Pricing",
    navLabel: "Footer",
    tagline: "Prepares every application. Sends when you approve.",
    copyright: "© 2026 Overture",
  },
  cta: {
    startTrial: "Start the trial",
    seeSteps: "See the steps",
    chooseWeek: "Choose Week",
    chooseMonth: "Choose Month",
  },
  landing: {
    eyebrow: "For one person's job search",
    headline: "Overture prepares every application. It sends only when you approve.",
    lede: "It matches Postings to your Targets, fills each application from your Facts and resume, and shows every answer before anything is sent.",
    trialNote: `Verify a card to start. The trial is ${String(TRIAL.applications)} applications, once per card.`,
    hero: {
      groupLabel:
        "Example: each Ready Application lines up what the posting asks against your resume, then waits for Send.",
      card: {
        mark: "N",
        role: "Platform Engineer",
        company: "Northwind Labs",
        meta: "Toronto, ON · Remote · CA$142k–168k",
        score: 91,
        rows: [
          ["5+ yrs Kubernetes", "6 yrs running EKS at scale"],
          ["Remote in Canada", "Toronto, remote preferred"],
        ],
      },
      askLabel: "The posting asks",
      factLabel: "Your resume",
      note: "14 answers from your Facts · letter tailored · resume unchanged",
      stamp: "Ready to send",
      stampNote: "waits for your approval",
      send: "Send",
      skip: "Skip",
      tally: [
        ["Ready", String(TRIAL.applications)],
        ["Needs you", "1"],
      ] as const,
      railLabel: `Send window ${sendHours}, next send at 09:12`,
      railTicks,
      markerPos: "10%",
      markerTime: "9:12 am",
    },
    howEyebrow: "How it works",
    howTitleLead: "How it",
    howTitleItalic: "works",
    howLede:
      "One application, from a fresh Posting to the recruiter's reply. Set your Targets once and inspect every step.",
    movements: {
      discovery: {
        number: "1",
        roman: "I.",
        title: "Discovery",
        label: "New postings",
        nextCheck: "Next check 09:00",
        postings: [
          { mark: "N", role: "Platform Engineer", company: "Northwind Labs · Toronto, ON" },
          { mark: "F", role: "DevOps Engineer", company: "Ferro Cloud · Remote, Canada" },
          { mark: "H", role: "Senior Backend Engineer", company: "Halden Systems · Ottawa, ON" },
          { mark: "L", role: "Platform Engineer", company: "Larkspur Health · Vancouver, BC" },
        ],
        body: `Overture checks the ${atsCount.toLowerCase()} hiring systems for fresh Postings that match your Targets: roles, locations and salary floor.`,
      },
      screening: {
        number: "2",
        roman: "II.",
        title: "Screening",
        role: "Platform Engineer",
        company: "Northwind Labs",
        score: 91,
        why: ["6 yrs Kubernetes, asked for 5", "Remote in Canada"],
        body: "Each Posting gets a Match score against your resume with plain reasons. Anything below your bar is passed over before a form opens.",
      },
      preparation: {
        number: "3",
        roman: "III.",
        title: "Preparation",
        answers: [
          {
            question: "Years of Kubernetes experience",
            answer: "6 years",
            source: "From your resume",
          },
          { question: "Authorised to work in Canada?", answer: "Yes", source: "From your Facts" },
        ],
        body: "Every answer is filled from your resume and your Facts. Nothing is guessed or invented.",
      },
      review: {
        number: "4",
        roman: "IV.",
        title: "Review",
        pill: "Needs you",
        question: "Are you authorised to work in the UK?",
        unblocks: "Unblocks 4 applications",
        action: "Answer once",
        body: "Approve the ones you want. Anything uncertain pauses as a Review, and answering once moves every Application waiting on it forward.",
      },
      overture: {
        number: "5",
        roman: "V.",
        title: "Overture",
        greeting: "Dear hiring team at ",
        greetingSuffix: ",",
        company: "Northwind Labs",
        letter:
          "Six years of running Kubernetes platforms is why the Platform Engineer role caught my eye. I would bring the same care to your…",
        resume: "Resume.pdf · sent unchanged",
        body: "A cover letter is drafted for the role while your resume PDF is attached unchanged — and sent only after you approve.",
      },
      comeback: {
        number: "6",
        roman: "VI.",
        title: "What comes back",
        boardLabel:
          "A Board with Queued, Ready, Applied and Screening columns, holding the applications Overture prepared",
        columns: [
          {
            title: "Queued",
            count: "2",
            cards: [{ name: "Larkspur Health", role: "Platform Engineer" }],
          },
          {
            title: "Ready",
            count: "3",
            cards: [{ name: "Quill & Ash", role: "Backend Engineer" }],
          },
          {
            title: "Applied",
            count: "2",
            cards: [{ name: "Ferro Cloud", role: "DevOps Engineer" }],
          },
          {
            title: "Screening",
            count: "1",
            cards: [{ name: "Northwind Labs", role: "Staff Platform Engineer" }],
          },
        ],
        body: "Every sent Application lands on your Board with a full record. A recruiter reply moves the card on.",
      },
    },
    repliesEyebrow: "Replies",
    repliesTitleLead: "Every reply,",
    repliesTitleItalic: "read and sorted.",
    repliesLede:
      "Forward only ATS mail to your forwarding address. Overture classifies each recruiter reply and moves the matching card on your Board.",
    replies: {
      inboxLabel: "Your inbox",
      readOnly: "read-only",
      emails: [
        {
          mark: "N",
          from: "Northwind Labs · Recruiting",
          time: "09:12",
          subject: "Next steps for the Platform Engineer role",
          preview:
            "Hi Maya, thanks for applying. We would like to set up a 30 minute call this week to talk through the role…",
          label: "Interview request",
        },
        {
          mark: "F",
          from: "Ferro Cloud · Recruiting",
          time: "11:48",
          subject: "Update on your application",
          preview:
            "Thank you for your interest in the DevOps Engineer role. After review we have decided to move forward with other candidates…",
          label: "Rejection",
        },
      ] as const,
      boardLabel:
        "Board: the Northwind Labs card moved to Interviewing, the Ferro Cloud card to Closed as Rejected",
      columns: ["Applied", "Screening", "Interviewing", "Closed"] as const,
      cards: [
        { column: 0, top: "56px", name: "Halden Systems", role: "Senior Backend Eng." },
        { column: 1, top: "134px", name: "Larkspur Health", role: "Platform Engineer" },
        { column: 1, top: "212px", name: "Quill & Ash", role: "Backend Engineer", muted: true },
        { column: 2, top: "56px", name: "Northwind Labs", role: "Platform Engineer", hot: true },
        { column: 3, top: "134px", name: "Corva Maps", role: "Infrastructure Eng.", muted: true },
        {
          column: 3,
          top: "56px",
          name: "Ferro Cloud",
          role: "DevOps Engineer",
          hot: true,
          tag: "Rejected",
        },
      ] as const,
      note: "Moved to Interviewing · 2 min ago",
      trust:
        "Read-only. Overture never sends mail from your account — you reply from your own mailbox.",
    },
    atsEyebrow: "Where it applies",
    atsTitle: "Applies where companies actually ",
    atsTitleItalic: "hire.",
    atsCount: `${atsCount} applicant tracking systems`,
    atsNote: "Direct from company career pages. No aggregators, no stale listings.",
    atsDirect: "Direct submission",
    atsDirectNote:
      "Overture fills the employer's own application form and submits it after you approve.",
    atsSubmitted: "Submitted today",
    atsSubmittedCount: "17",
    atsStageLabel: `Overture applies directly through ${atsList}`,
    atsSubmittedTag: "Submitted",
    controlEyebrow: "Control and honesty",
    controlTitleLead: "Built on",
    controlTitleItalic: "your facts.",
    controlLede:
      "Three rules govern every application Overture prepares. Nothing goes out behind your back.",
    control: [
      {
        number: "01",
        title: "Every answer traces to your facts",
        body: "Each Fact stores the exact source of a reusable answer — your resume, or a reply you saved once.",
        proof: "Facts · source linked",
      },
      {
        number: "02",
        title: "Nothing uncertain gets sent",
        body: "When a form asks something missing from your Profile, Overture pauses it as a Review until you answer.",
        proof: "Needs you · answer once, reuse everywhere",
      },
      {
        number: "03",
        title: "See exactly what was submitted",
        body: "Every Application keeps a dated Timeline of the Posting, the Match score, the answers, the letter and the unchanged resume PDF.",
        proof: "Timeline · complete dossier",
      },
    ],
    boardTitle: "Each application moves across the Board",
    boardLede:
      "The Board shows where every application stands with the employer, from Queued to Closed.",
    stages: [
      { title: "Queued", body: "Being prepared, or waiting on a Review." },
      { title: "Ready", body: "Prepared and waiting for your Send." },
      { title: "Applied", body: "Sent to the employer, and confirmed." },
      { title: "Screening", body: "The employer has replied." },
    ],
    failureTitle: "Never charged for failure",
    failureBody:
      "An Application that can't be sent, or whose sending can't be confirmed, is marked Couldn't apply and never uses one of your applications. Only an Application confirmed sent counts against your plan. Applications left is always on Home.",
    pricingEyebrow: "Pricing",
    pricingTitle: "Start with three applications.",
    pricingLede:
      "Then Week or Month, renewing until you cancel. Only an Application confirmed sent counts.",
    pricingSeeAll: "See the full plans",
    pricingIncludesTitle: "Every plan includes",
    pricingIncludes: [
      "Every application is shown to you as Ready to send before anything is sent.",
      `Send goes out in daytime hours, ${sendHours} your local time, at least ${String(SEND_WINDOW.minGapMinutes)} minutes apart, up to ${String(SEND_WINDOW.maxPerDay)} a day.`,
      `One company per ${String(PLANS.month.periodDays)} days.`,
      `${atsList}.`,
    ],
    faqEyebrow: "Questions",
    faqTitleLead: "Questions",
    faqTitleItalic: "and answers.",
    faq: [
      {
        question: "Does Overture edit my resume?",
        answer:
          "No. Your resume PDF is sent unchanged with every Application. Only the cover letter adapts to each role.",
      },
      {
        question: "What happens when it's unsure about an answer?",
        answer:
          "The Application pauses as a Review instead of guessing. Answer once and every Application waiting on that question moves forward.",
      },
      {
        question: "Can I see what was submitted?",
        answer:
          "Yes. Every Application keeps a dated Timeline with the Posting, the Match score, every answer and its source, the cover letter and the resume PDF.",
      },
      {
        question: "Which job sites does it check?",
        answer: `Company career pages running ${atsList} — the ${atsCount.toLowerCase()} systems Overture supports. Direct sources only, no aggregators or stale listings.`,
      },
      {
        question: "When does it send?",
        answer: `Only after you approve, and only between ${sendHours} your local time, at least ${String(SEND_WINDOW.minGapMinutes)} minutes apart and up to ${String(SEND_WINDOW.maxPerDay)} a day. Undo until sending starts.`,
      },
      {
        question: "Can I pause it?",
        answer:
          "Yes. Pause or resume from Home at any time. Nothing new is sent while it is paused.",
      },
    ],
    closingTitleLead: "Let Overture handle the",
    closingTitleItalic: "applying.",
    closingLede:
      "Upload your resume once. Overture finds fresh roles, prepares each application from your Facts, and asks before it guesses.",
    closingSignIn: "Sign in",
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
      "Every application is shown to you as Ready to send before anything is sent.",
      `Send goes out in daytime hours, ${sendHours} your local time, at least ${String(SEND_WINDOW.minGapMinutes)} minutes apart, up to ${String(SEND_WINDOW.maxPerDay)} a day.`,
      `One company per ${String(PLANS.month.periodDays)} days.`,
      `${atsList}.`,
    ],
  },
} as const;
