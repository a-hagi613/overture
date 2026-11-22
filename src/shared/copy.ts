const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS_WORDS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

function countWord(count: number) {
  if (count < 20) {
    return COUNT_WORDS[count] ?? String(count);
  }

  if (count < 100) {
    const tens = TENS_WORDS[Math.floor(count / 10)] ?? "";
    const ones = count % 10;

    return ones === 0 ? tens : `${tens}-${COUNT_WORDS[ones] ?? ""}`;
  }

  return String(count);
}

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

function ordinal(count: number) {
  const remainder = count % 100;

  if (remainder >= 11 && remainder <= 13) {
    return `${String(count)}th`;
  }

  if (count % 10 === 1) {
    return `${String(count)}st`;
  }

  if (count % 10 === 2) {
    return `${String(count)}nd`;
  }

  if (count % 10 === 3) {
    return `${String(count)}rd`;
  }

  return `${String(count)}th`;
}

export const PAUSE_REASONS = [
  "user",
  "onboarding",
  "no_resume",
  "plan_ended",
  "payment_failed",
  "suspended",
  "no_mailbox",
] as const;

export type PauseReason = (typeof PAUSE_REASONS)[number];

const FAILED_REASON_TEXT = new Map<string, string>([
  ["ats_flagged", "The employer's site flagged the application, so nothing was sent."],
  ["blocked", "The employer's site blocked the attempt before anything was sent."],
  ["captcha_blocked", "A challenge stopped the attempt, so nothing was sent."],
  ["code_timeout", "The verification code never arrived, so nothing was sent."],
  ["crash", "The browser session stopped before anything was sent."],
  ["form_changed", "The form changed after we had filled it in, so we stopped before sending."],
  ["posting_closed", "The role closed before Overture could send."],
  ["provider_error", "The browser session failed before anything was sent."],
  ["timeout", "The employer's site took too long to answer, so nothing was sent."],
  [
    "unconfirmed",
    "Overture couldn't confirm this one reached the employer, so it won't send it again.",
  ],
  ["upload_failed", "The resume upload failed, so nothing was sent."],
]);

export function failedReasonText(reason: string | null) {
  return FAILED_REASON_TEXT.get(reason ?? "");
}

const ADMIN_PROBE_OUTCOME_LABELS = new Map([
  ["readable", "Complete"],
  ["needs_review", "Needs a review"],
  ["unsupported", "Unsupported field"],
  ["unreadable", "Unreadable"],
]);

export const copy = {
  app: {
    name: "Overture",
    description: "A job-search agent that applies to roles for you, and shows its work.",
    rootMissing: "The application root element is missing from the document.",
  },
  demo: {
    locked:
      "The demo account is view-only for this, so nobody can spend money or remove the demo data. Sign in with your own account to upload a file, score a posting, change an answer, export or delete.",
  },
  nav: {
    label: "Main",
    tabBarLabel: "Quick sections",
    home: "Home",
    ready: "Ready",
    board: "Board",
    review: "Review",
    inbox: "Inbox",
    calendar: "Calendar",
    profile: "Profile",
    readyCount: (count: number) => `Ready, ${String(count)} to send`,
    reviewCount: (count: number) => `Review, ${String(count)} waiting`,
    inboxCount: (count: number) => `Inbox, ${String(count)} unread`,
  },
  settingsMenu: {
    label: "Settings",
    pagesLabel: "Show settings pages",
    profileData: "Profile data",
    export: "Export",
    supportAccess: "Support access",
    delete: "Delete account",
    legal: "Terms and privacy",
  },
  brand: {
    homeAria: "Overture, Home",
  },
  shell: {
    settings: "Settings",
    skipToMain: "Skip to main content",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    skipToContent: "Skip to content",
    searchLabel: "Search",
    searchPlaceholder: "Search applications, reviews, emails",
    searchShortcut: "⌘K",
    themeToDark: "Switch to dark mode",
    themeToLight: "Switch to light mode",
    notifications: (count: number) => `Notifications, ${String(count)} unread`,
    notificationsEmpty: "Notifications",
  },
  signIn: {
    brandTagline: "The job hunt, handled.",
    back: "Back to Overture",
    title: "Sign in to Overture",
    sentTitle: "Check your email",
    description: "Continue to your Board and Review.",
    sentDescription: "We sent you a link that signs you in.",
    google: "Continue with Google",
    linkedin: "Continue with LinkedIn",
    linkedinBadge: "in",
    magicLegend: "or with your email",
    refusedLegend: "or use your email",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    magicSubmit: "Email me a sign-in link",
    orPlain: "or",
    resend: "Send the link again",
    resendHint: "Nothing there? Check spam, or wait a minute before asking again.",
    changeEmail: "Use a different email",
    allowHeading: "Invitation only for now.",
    allowNote: "Google, LinkedIn and emailed links all work with the same email.",
    sentHeading: "Link sent to",
    sentDetail: "Open it on this device. It works once and expires in 15 minutes.",
    legalIntro: "By continuing, you agree to Overture's",
    legalTerms: "Terms",
    legalJoin: "and",
    legalPrivacy: "Privacy Policy",
    legalEnd: ".",
    trust: "Google, LinkedIn or an emailed link",
    refusedHeading: "This email isn't invited yet.",
    refusedBody:
      "Overture is invite-only during the beta. Google, LinkedIn and an emailed link all need an invite for the same email.",
    refusedDescription:
      "If you expected an invite, check that you are using the email it was sent to.",
    refusedField:
      "That email is not on the invite list. Check the address, or use the email your invitation was sent to.",
    refusedEmail: "That email has no invite to Overture yet. Ask the owner for one.",
    accountSuspended: "This account is suspended, so it cannot sign in.",
    suspendedTitle: "Account suspended",
    suspendedDescription: "Sign-in is off for this account.",
    suspendedHeading: "This account is suspended.",
    suspendedBody:
      "While it is suspended, Overture does not prepare or send applications for it, and you cannot sign in.",
    suspendedHelp: "If you think this is a mistake, write to us and we will look at it.",
    suspendedEmail: "Email admin@tryoverture.com",
    emailNotVerified:
      "That provider has not verified your email, so this app cannot let it in. Verify the address and try again.",
    linkFailed: "The link did not work. It may be used or expired. Ask for a new one.",
    genericError: "Sign-in did not go through. Try again.",
    rateLimited: "Too many tries. Wait a few minutes and ask again.",
    captchaMissing: "Finish the bot check before continuing.",
    captchaFailed: "The bot check did not pass. Finish it again and retry.",
    captchaTimedOut: "The bot check timed out. Try again.",
    captchaExpired: "The bot check expired. Try again.",
    captchaUnavailable: "The bot check could not load. Check your connection and try again.",
    sampleLabel: "Sample data",
    story: {
      pill: "Personal job-search agent",
      backdropMonogram: "L",
      backdropRole: "Halden Systems · Senior Backend Engineer",
      backdropQueue: "Queued · sends about 14:10",
      heading: "The job hunt,",
      headingItalic: "handled.",
      deck: "Finds fresh roles from employers' job feeds, answers forms from the facts you saved, and asks you only when it cannot answer for itself.",
      receiptAria: "Sample of a submitted application, sample data",
      receiptMonogram: "N",
      receiptTitle: "Staff Platform Engineer",
      receiptMeta: "Northwind Labs · Remote, Canada · Greenhouse",
      scoreAria: "Sample Match score, 91 out of 100",
      score: "91",
      asksHeading: "ATS asks",
      factsHeading: "From your saved facts",
      asks: [
        "Canada work authorization",
        "Distributed Go & Kubernetes",
        "Target base compensation",
      ],
      facts: ["Authorized · no sponsorship", "Resume · 6 yrs production", "CAD 195k · Saved fact"],
      receiptStamp: "10:42 · Maya_Okafor_Resume.pdf",
      stamp: "Submitted",
      pillar01: "01",
      pillar01Title: "Resume untouched",
      pillar01Detail: "Your exact PDF sent unchanged, every time.",
      pillar02: "02",
      pillar02Title: "Truth-checked",
      pillar02Detail: "Every answer points back to a fact you wrote.",
      pillar03: "03",
      pillar03Title: "Asks, never guesses",
      pillar03Detail: "A question it cannot answer becomes a Review you answer once.",
    },
  },
  auth: {
    providers: {
      google: "Google",
      linkedin: "LinkedIn",
    },
    accountRefused: "That email has no invite to Overture yet. Ask the owner for one.",
    accountSuspended: "This account is suspended, so it cannot sign in.",
  },
  mail: {
    magicLinkSubject: "Your Overture sign-in link",
    magicLinkBody: (url: string) =>
      `Open this link to sign in to Overture. It works once and expires in 15 minutes.\n\n${url}\n`,
    accountDeletedSubject: "Your Overture account has been deleted",
    accountDeletedBody: (name: string) => {
      const first = name.trim().split(/\s+/u)[0] ?? "";
      const greeting = first === "" ? "Hi," : `Hi ${first},`;

      return [
        greeting,
        "",
        "Your Overture account and its data have been erased. Your forwarding address is retired and will not be used again.",
        "",
        "If you didn’t ask for this, write to admin@tryoverture.com as soon as you can.",
        "",
        "Overture",
        "",
      ].join("\n");
    },
    recapSubject: (ready: number, needAnswer: number) => {
      const readyPart = `${String(ready)} ready to approve`;

      return needAnswer > 0
        ? `Overture recap: ${readyPart}, ${String(needAnswer)} need an answer`
        : `Overture recap: ${readyPart}`;
    },
    recapBody: (input: {
      ready: { title: string; company: string }[];
      needAnswer: number;
      sent: { title: string; company: string }[];
      replied: { company: string }[];
      url: string;
    }) => {
      const lines =
        input.ready.length === 0
          ? ["No new applications are ready to approve."]
          : [
              input.ready.length === 1
                ? "1 application is ready to approve:"
                : `${String(input.ready.length)} applications are ready to approve:`,
              ...input.ready.map(
                (application) => `- ${application.title} at ${application.company}`,
              ),
            ];

      if (input.needAnswer > 0) {
        lines.push(
          "",
          input.needAnswer === 1
            ? "1 question needs an answer."
            : `${String(input.needAnswer)} questions need an answer.`,
        );
      }

      if (input.sent.length > 0) {
        lines.push(
          "",
          "Sent yesterday:",
          ...input.sent.map((application) => `- ${application.title} at ${application.company}`),
        );
      }

      if (input.replied.length > 0) {
        lines.push(
          "",
          input.replied.length === 1
            ? "1 employer replied yesterday:"
            : "Employers replied yesterday:",
          ...input.replied.map((reply) => `- ${reply.company}`),
        );
      }

      lines.push("", `Review them at ${input.url}`);

      return `${lines.join("\n")}\n`;
    },
    billingPauseSubject: (reason: "plan_ended" | "payment_failed") =>
      reason === "plan_ended"
        ? "Your Overture plan has ended"
        : "Your Overture payment didn't go through",
    billingPauseBody: (input: { title: string; copy: string; fix: string; url: string }) =>
      [
        input.title,
        "",
        input.copy,
        "",
        `${input.fix}: ${input.url}`,
        "",
        "Applications already in flight will finish. Nothing new is sent until this is fixed.",
        "",
        "Overture",
        "",
      ].join("\n"),
    exportReadySubject: "Your Overture export is ready",
    exportReadyBody: (url: string) =>
      `Your Overture export is ready to download.\n\nOpen Settings in Overture and choose Download export. The link is valid for 24 hours, then the archive is deleted.\n\n${url}\n\nIf you didn't ask for this, write to admin@tryoverture.com.\n`,
  },
  stages: {
    queued: "Queued",
    applied: "Applied",
    screening: "Screening",
    interviewing: "Interviewing",
    offer: "Offer",
    closed: "Closed",
  },
  home: {
    title: "Home",
    dateLocale: "en-US",
    greetingMorning: "Good morning,",
    greetingAfternoon: "Good afternoon,",
    greetingEvening: "Good evening,",
    applicationsLeft: "Applications left",
    sentToday: "Sent today",
    usageCount: String,
    usagePlan: (plan: number) => `of ${String(plan)} on your week plan`,
    usageSentToday: (sent: number, cap: number) =>
      `${String(sent)} of ${String(cap)} sent today · resets at midnight`,
    usageAria: (count: number) => `${String(count)} applications left`,
    daySoFar: "The day so far",
    ready: {
      action: "Review and send",
      eyebrow: "Ready to send",
      title: (ready: number, approved: number) =>
        `${String(ready)} ready to send · ${String(approved)} approved`,
    },
    codeWait: {
      eyebrow: "Needs you",
      expires: (time: string) => `Expires in ${time}`,
      titlePlain: (company: string) => company,
      titleItalic: "needs a code.",
      body:
        "The form asked for a code sent to your email. Paste it in Overture within ten minutes, or the " +
        "Application ends and can be tried again later.",
      asked:
        "Five minutes have passed with no forwarded mail. The form stays open until the timer ends.",
      paste: "Paste the code",
      noCode: "No code yet",
    },
    rangeLabel: "Date range",
    ranges: { d7: "7D", d30: "30D", d90: "90D" },
    running: "Auto-apply running",
    paused: "Auto-apply paused",
    pause: "Pause",
    start: "Start",
    switchAria: (running: boolean) => (running ? "Pause auto-apply" : "Start auto-apply"),
    kpi: {
      sent: "Applications sent",
      queued: "Queued, ready to send",
      replies: "Replies · interviews",
      needsYou: "Needs you",
    },
    sentDelta: (delta: number, days: number) =>
      `${delta < 0 ? "−" : "+"}${String(Math.abs(delta))} vs the previous ${String(days)} days`,
    nextSends: (time: string) => `Next one sends about ${time}`,
    nextSendValue: "None yet",
    heldWhilePaused: "Held while sending is paused",
    outOfApplications: {
      title: "Out of Applications.",
      copy: "Approved Applications wait for your next period or a new plan. Nothing is sent without an Application left. Ready Applications stay ready.",
      choosePlan: "Choose a plan",
      seeBoard: "See the Board",
    },
    grantEnding: {
      title: "Invite grant running out.",
      copy: (left: number, date: string) =>
        `Your invite grant has ${left === 1 ? "1 Application" : `${String(left)} Applications`} left and ends on ${date}. Choose a plan to keep preparing Applications after the grant ends. Invite grants are not charged.`,
      choosePlan: "Choose a plan",
    },
    pauseReasons: {
      user: {
        copy: "Nothing new is sent until you resume.",
        fix: "Resume",
        title: "Paused by you.",
      },
      onboarding: {
        copy: "Sending starts once your facts, forwarding and consent are in.",
        fix: "Finish setup",
        title: "Setup isn't finished.",
      },
      no_resume: {
        copy: "Overture sends only the exact file you upload, so it needs one first.",
        fix: "Upload resume",
        title: "No resume on file.",
      },
      plan_ended: {
        copy: "Sending stopped when it ran out. Your queue and history are kept.",
        fix: "Choose a plan",
        title: "Your plan has ended.",
      },
      payment_failed: {
        copy: "Sending stays paused until the card is updated.",
        fix: "Update payment",
        title: "Payment didn't go through.",
      },
      suspended: {
        copy: "Sending is paused while we check it. Support can tell you more.",
        fix: "Contact support",
        title: "Your account is under review.",
      },
      no_mailbox: {
        copy: "We need your ATS mail forwarded to see replies and confirmations.",
        fix: "Set up forwarding",
        title: "Forwarding isn't set up.",
      },
    } satisfies Record<PauseReason, { copy: string; fix: string; title: string }>,
    queue: {
      eyebrow: "Queue",
      inLine: ordinal,
      inLineTail: "in line",
      noPosition: "In line",
      nextAt: (time: string) => `Next send around ${time} once sending resumes.`,
      waiting: "Next send once sending resumes.",
    },
    checkIn: {
      answerAria: (answer: string, company: string, title: string) =>
        `${answer}: ${title} at ${company}`,
      eyebrow: "Weekly check-in",
      failed: "The check-in did not go through. Try again.",
      interviewing: "Interviewing",
      note: "Three quick questions about this week. It takes about a minute.",
      rejected: "Rejected",
      row: (days: number) => `${countWord(days)} days in Applied`,
      start: "Start check-in",
      stillWaiting: "Still waiting",
      title: "How is the search going?",
    },
    activity: {
      couldNotApply: "Couldn't apply",
      couldNotApplyAria: (company: string, title: string) => `Couldn't apply: ${company}, ${title}`,
      confirming: "Confirming",
      failedDefault: "Overture stopped before sending.",
      latest: "Latest first",
      nothingCharged: "Nothing was charged.",
      sent: "Sent · confirmed",
      title: "Activity",
    },
    strengthen: {
      action: "Add facts",
      eyebrow: "Tier 2 · Strengthen your profile",
      note: "Saved facts answer common questions, so each one means fewer Reviews for you.",
      title: (missing: number) =>
        `Add ${countWord(missing)} ${plural(missing, "fact", "facts")} from your last role`,
    },
    interviewsBooked: (count: number) =>
      `${String(count)} ${plural(count, "interview", "interviews")} booked`,
    applicationsWait: (count: number) =>
      `${capitalize(countWord(count))} ${plural(count, "application waits", "applications wait")} on these`,
    chart: {
      title: "Applications sent",
      today: (count: number) => `Today ${String(count)}`,
      thisWeek: (count: number) => `This week ${String(count)}`,
      aria: (subtitle: string, total: number) =>
        `Applications sent, ${subtitle.toLowerCase()}, total ${String(total)}`,
      perDay7: "Per day, last 7 days",
      perDay30: "Per day, last 30 days",
      perWeek90: "Per week, last 90 days",
    },
    needsYou: {
      title: "Needs you",
      note: "Open questions, grouped by jobs unlocked",
      jobsUnlocked: (count: number) =>
        `${String(count)} ${plural(count, "job unlocked", "jobs unlocked")}`,
      footer: (questions: number, applications: number) =>
        `${capitalize(countWord(questions))} ${plural(questions, "question", "questions")}, ` +
        `${countWord(applications)} ${plural(applications, "application", "applications")} waiting`,
      open: "Open Review",
      empty: "Nothing needs you right now.",
    },
    inbox: {
      title: "Recent in your Inbox",
      open: "Open Inbox",
      ack: "confirmed they received your application",
      screening: "invited you to a screening call",
      offer: "sent you an offer",
      rejection: (title: string | null) =>
        title === null ? "is not moving forward" : `is not moving forward with ${title}`,
      replied: (subject: string) =>
        subject.trim() === "" ? "replied" : `replied: ${subject.trim()}`,
      interview: (subject: string) =>
        subject.trim() === ""
          ? "asked to schedule an interview"
          : `asked to schedule an interview: ${subject.trim()}`,
      movedFromTo: (from: string, to: string) => `Moved from ${from} to ${to}`,
      movedTo: (to: string) => `Moved to ${to}`,
      filedUnder: (stage: string) => `Filed under ${stage}`,
      empty: "No employer mail yet.",
    },
  },
  legal: {
    back: "Back to Overture",
    eyebrow: "Legal",
    lastUpdated: "Last updated 21 November 2026",
    metaSeparator: " · ",
    effective: "Effective when the plans open to the public",
    footerName: "Overture",
    footerContact: "admin@tryoverture.com",
    footerAddress: "[POSTAL ADDRESS]",
    footerSeparator: " · ",
    footerLinksLabel: "Legal pages",
    draftNotice:
      "Draft for owner review, not legal advice. Billing terms take effect when the plans open to the public.",
    termsLink: "Terms of Service",
    privacyLink: "Privacy Policy",
    contactHref: "mailto:admin@tryoverture.com",
    dateLocale: "en-GB",
    terms: {
      title: "Terms of Service",
      sections: [
        {
          heading: "Who we are",
          blocks: [
            {
              kind: "paragraphWithLink",
              before: "Overture is a job-search service run by Overture. You can reach us at ",
              after: ". Our postal address is [POSTAL ADDRESS].",
              href: "mailto:admin@tryoverture.com",
              link: "admin@tryoverture.com",
            },
          ],
        },
        {
          heading: "What Overture does",
          blocks: [
            {
              kind: "paragraph",
              text: "Overture finds jobs that fit what you want, prepares each application from the resume and facts you save, and sends an application only after you approve it. You can skip or edit an application before you send it.",
            },
          ],
        },
        {
          heading: "Your account",
          blocks: [
            {
              kind: "paragraph",
              text: "You sign in with Google, LinkedIn or an emailed link. Keep your sign-in details to yourself, and tell us if you think someone else has used your account.",
            },
          ],
        },
        {
          heading: "Your resume and facts",
          blocks: [
            {
              kind: "paragraph",
              text: "You own what you give Overture. We use it to prepare the applications you approve and for nothing else. The Privacy Policy explains how we keep it safe.",
            },
          ],
        },
        {
          heading: "Plans and payment",
          blocks: [
            {
              kind: "paragraph",
              text: "Overture is a paid service after the free trial. The Week plan costs $12 and includes 70 applications over 7 days. The Month plan costs $35 and includes 300 applications over 30 days. Checkout shows the price in your local currency, and taxes are added where they apply. Stripe takes the payment and is the merchant of record for each charge.",
            },
            {
              kind: "paragraph",
              text: "Accounts invited during the beta keep the applications their invite included. They choose a plan when those run out.",
            },
          ],
        },
        {
          heading: "Free trial",
          blocks: [
            {
              kind: "paragraph",
              text: "A new account can try Overture with 3 applications at no charge. The trial starts after a card is checked with Stripe: Stripe verifies the card with a temporary authorisation and does not charge it. One card gets one trial. To enforce that, we keep a keyed fingerprint of the card, not the card number, apart from your account. It is not linked to you and it survives deleting your account.",
            },
          ],
        },
        {
          heading: "Renewal",
          blocks: [
            {
              kind: "paragraph",
              text: "The Week and Month plans are subscriptions. Each one renews automatically at the end of its period at the price you agreed, until you cancel. Every paid period issues its allowance in full: 70 applications for Week over 7 days, 300 for Month over 30 days. Unused applications do not roll over. They expire when the period ends and are never refunded.",
            },
            {
              kind: "paragraph",
              text: "If a renewal payment fails, Overture pauses preparing and sending new applications until the payment succeeds or you choose another plan. Applications already sent are not affected.",
            },
          ],
        },
        {
          heading: "Cancelling",
          blocks: [
            {
              kind: "paragraph",
              text: "You can cancel at any time from Settings, which opens the Stripe customer portal. Cancelling stops the next renewal. Your current period keeps running to its end, and its remaining applications stay usable until then. If you move between Week and Month, the new plan starts at your next renewal, not straight away.",
            },
          ],
        },
        {
          heading: "Refunds and failed applications",
          blocks: [
            {
              kind: "paragraph",
              text: "We do not give refunds by default, including for a period you cancel part-way through or for applications you did not use. A failed application is different: if Overture could not send an application, that attempt is never charged and never uses one of your applications. You can try it again within your allowance.",
            },
            {
              kind: "paragraphWithLink",
              before: "If you think you were charged in error, write to ",
              after: " and we will look at it.",
              href: "mailto:admin@tryoverture.com",
              link: "admin@tryoverture.com",
            },
          ],
        },
        {
          heading: "What you agree to on each application",
          blocks: [
            {
              kind: "paragraph",
              text: "Each application you approve records the version of the consent text you agreed to. You can read every version in your Settings.",
            },
          ],
        },
        {
          heading: "What we cannot promise",
          blocks: [
            {
              kind: "paragraph",
              text: "Overture cannot make an employer reply, and it does not decide who is hired. Each employer's form and rules still apply to your application.",
            },
          ],
        },
        {
          heading: "Suspension and ending",
          blocks: [
            {
              kind: "paragraph",
              text: "We may suspend an account that breaks these terms or puts other people at risk. You can stop using Overture at any time and delete your account from Settings.",
            },
          ],
        },
        {
          heading: "Changes",
          blocks: [
            {
              kind: "paragraph",
              text: "If we change these terms, we will tell you by email before the change takes effect. A change to a price applies from your next renewal.",
            },
          ],
        },
        {
          heading: "Contact",
          blocks: [
            {
              kind: "paragraphWithLink",
              before: "Questions about these terms: ",
              after: ".",
              href: "mailto:admin@tryoverture.com",
              link: "admin@tryoverture.com",
            },
          ],
        },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      sections: [
        {
          heading: "Who we are",
          blocks: [
            {
              kind: "paragraphWithLink",
              before: "Overture is run by Overture. Contact us at ",
              after: ". Our postal address is [POSTAL ADDRESS].",
              href: "mailto:admin@tryoverture.com",
              link: "admin@tryoverture.com",
            },
          ],
        },
        {
          heading: "What we collect",
          blocks: [
            {
              kind: "bullets",
              items: [
                "Your account: your email and, if you sign in with Google or LinkedIn, the name and photo that Google or LinkedIn shares.",
                "Your resume, the facts you save, your targets and your skip list.",
                "Your forwarding address, and the job emails you forward to it.",
                "Application records: what was filled in, what you approved, what was sent and when.",
                "The consent versions you agreed to, and the records needed to keep the service running and secure.",
                "Billing records: your plan, the invoices Stripe issues, the payment status, and the last four digits and expiry of the card Stripe holds. We never store the full card number.",
              ],
            },
          ],
        },
        {
          heading: "Why we use it",
          blocks: [
            {
              kind: "paragraph",
              text: "To find jobs for you, prepare and send the applications you approve, email you what you asked for (sign-in and verification links, the daily recap), take and track your payments, and keep Overture safe.",
            },
          ],
        },
        {
          heading: "Who processes it for us",
          blocks: [
            {
              kind: "paragraph",
              text: "These companies process data on our behalf. We update this list when it changes.",
            },
            {
              kind: "processors",
              companyLabel: "Company",
              doesLabel: "What it does for Overture",
              rows: [
                { does: "Hosts the Overture app and its database.", name: "Fly" },
                {
                  does: "Domain name service, email, file storage and background workers.",
                  name: "Cloudflare",
                },
                {
                  does: "Cloud browsers that fill in job application forms for you.",
                  name: "Browser Use",
                },
                {
                  does: "A backup cloud browser, used only when the main one cannot be used.",
                  name: "Kernel",
                },
                {
                  does: "The language model that matches jobs and drafts answers from your facts.",
                  name: "Anthropic",
                },
                { does: "Service logs and health monitoring.", name: "Grafana Cloud" },
                {
                  does: "Takes payments, holds the card details and handles tax as merchant of record.",
                  name: "Stripe",
                },
              ],
            },
          ],
        },
        {
          heading: "Payments and card details",
          blocks: [
            {
              kind: "paragraph",
              text: "Stripe processes payments for Overture as a sub-processor and is the merchant of record for each charge. Card details go from your browser to Stripe and are never stored by Overture. Stripe sends us the plan, the invoices, the payment status and the last four digits and expiry of the card, and we keep those records to run your allowance, answer questions and meet tax and accounting rules.",
            },
            {
              kind: "paragraph",
              text: "For the free trial we store a keyed fingerprint of the card, not the card number. It is not linked to your account and it survives deleting your account, so one card cannot start a second trial.",
            },
          ],
        },
        {
          heading: "How we keep it safe",
          blocks: [
            {
              kind: "paragraph",
              text: "Your files and answers are encrypted. Access to your data is limited to what the service needs, and every time staff open a user's data it is recorded.",
            },
          ],
        },
        {
          heading: "Your rights",
          blocks: [
            {
              kind: "paragraphWithLink",
              before:
                "You can export your data and delete your account from Settings. For anything else, write to ",
              after: ".",
              href: "mailto:admin@tryoverture.com",
              link: "admin@tryoverture.com",
            },
            {
              kind: "paragraph",
              text: "Deleting your account removes your billing records with it. Stripe keeps the invoices it must keep as merchant of record. The keyed card fingerprint used for the free trial is not linked to you and is kept so the same card cannot start a second trial.",
            },
          ],
        },
        {
          heading: "Changes and contact",
          blocks: [
            {
              kind: "paragraphWithLink",
              before:
                "If we change this policy, we will tell you by email before the change takes effect. Questions: ",
              after: ".",
              href: "mailto:admin@tryoverture.com",
              link: "admin@tryoverture.com",
            },
          ],
        },
      ],
    },
  },
  consent: {
    eyebrow: "Consent",
    versionLabel: (version: string) => `Version ${version}`,
    title: "What you agree to",
    readNoticeBefore: "I have read the ",
    readNoticeBetween: " and the ",
    readNoticeEnd: ".",
    agree: "I agree to this.",
    footnote:
      "Overture records the version you agreed to with each application you approve. Earlier versions stay on record, unchanged.",
    accepted: (version: string, date: string) => `Version ${version} agreed ${date}.`,
    acceptFailed: "That did not save. Do not start yet; try again in a moment.",
    unavailable: "The consent text could not be loaded.",
    earlierHeading: "Earlier versions",
    earlierNote: "Every version stays on record exactly as it was published.",
    publishedOn: (date: string) => `Published ${date}`,
  },
  calendar: {
    lead: "Applications, replies and interviews by day",
    titlePlain: "Your",
    titleItalic: "Calendar",
    dateLocale: "en-GB",
    today: "Today",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    gridLabel: (month: string) => `${month}, one day per cell`,
    legendLabel: "Colour key",
    dayPanel: "Day panel",
    closePanel: "Close day panel",
    agenda: "Agenda",
    loading: "Loading the Calendar",
    emptyMonth: "Nothing yet. Applications you send and replies from employers appear here.",
    emptyDay: "Nothing on this day.",
    errorTitle: "The Calendar did not load.",
    errorBody: "Your Applications are safe. Try again in a moment.",
    retry: "Try again",
    nothing: "nothing",
    kinds: {
      checkin: "Check-in",
      closed: "Closed",
      interview: "Interview",
      offer: "Offer",
      sent: "Sent",
      stage: "Stage move",
    },
    countLabels: {
      checkin: (count: number) => `${String(count)} ${count === 1 ? "check-in" : "check-ins"}`,
      closed: (count: number) => `${String(count)} closed`,
      interview: (count: number) => `${String(count)} ${count === 1 ? "interview" : "interviews"}`,
      offer: (count: number) => `${String(count)} ${count === 1 ? "offer" : "offers"}`,
      sent: (count: number) => `${String(count)} sent`,
      stage: (count: number) => `${String(count)} ${count === 1 ? "stage move" : "stage moves"}`,
    },
    sentToday: (count: number) => `${String(count)} sent today`,
    more: (count: number) => `+${String(count)} more`,
    sentRollup: (count: number) =>
      `${String(count)} ${count === 1 ? "application" : "applications"} sent`,
    andMore: (names: string, count: number) => `${names} and ${String(count)} more`,
    movedTo: (stage: string) => `Moved to ${stage}`,
    checkinDue: "Check-in due",
    stages: {
      applied: "Applied",
      closed: "Closed",
      interviewing: "Interviewing",
      offer: "Offer",
      screening: "Screening",
    },
    closedReason: (reason: string | null) =>
      reason === null ? "Closed" : `Closed · ${reason.replaceAll("_", " ")}`,
  },
  inbox: {
    accountNote: "Mail from other senders stays in your own mailbox and never reaches Overture.",
    addressBody:
      "Overture gives you one private address. You add one filter in your own mailbox that forwards only mail from employers' hiring systems to it. Overture reads replies and confirmations from there.",
    addressCopied: "Address copied",
    addressCopy: "Copy address",
    addressCopyFailed: "Copying did not work here. Select the address and copy it by hand.",
    addressEyebrow: "Your forwarding address",
    addressFilterGuide: "Read the filter guide",
    addressFilterHeading: "Add the",
    addressFilterItalic: "filter.",
    addressFilterSkip:
      "Skipping this is fine. Without the filter, a verification code is asked for as a paste, within ten minutes. The first forwarded mail shows here and on Profile.",
    addressHowLink: "How forwarding works",
    addressLead:
      "Replies and confirmations from employers, forwarded from your own mailbox. The Inbox is read-only: reply from your own mailbox.",
    addressNeverType: "Never type this address on an application form.",
    addressNeverTypeDetail:
      "Forms get your real email address, so employers reply to you directly.",
    addressTitleItalic: "address.",
    addressTitlePlain: "Forwarding ",
    addressWhatHeading: "What it",
    addressWhatItalic: "is.",
    allCount: (count: number) => `All ${String(count)}`,
    attachments: (count: number) => `Attachments (${String(count)})`,
    backToInbox: "← Inbox",
    boardLink: (title: string) => `${title}, on the Board →`,
    codeUsed: "Code used",
    unverifiedLabel: "Couldn't verify sender",
    download: "Download",
    emptyBody:
      "Once your ATS mail is forwarded, employer replies and confirmations appear here. Until then there is nothing to read.",
    emptyNote:
      "Forwarding is optional. Without it, a verification code is asked for as a paste, within ten minutes.",
    emptyPrimary: "Set up forwarding",
    emptySecondary: "Read the filter guide",
    emptyTitleItalic: "yet.",
    emptyTitlePlain: "Nothing forwarded ",
    emptyZero: "0",
    filterLabel: "Filter threads",
    fromLine: (from: string, stamp: string, verified: boolean) =>
      `From: ${from} · ${stamp} · ${verified ? "Sender verified" : "Sender not verified"}`,
    gmailHeading: "Gmail",
    gmailSteps: [
      "Open Settings, then Filters and Blocked Addresses, then Create a new filter.",
      "In From, enter the hiring-system domains: Greenhouse, Lever, Ashby, Workable and Personio.",
      "Choose Forward it to, and enter your forwarding address above.",
      "Create the filter. Mail that matches it is forwarded from now on.",
    ],
    latest: "Newest first",
    loadFailed: "The Inbox could not be loaded.",
    loading: "Loading your Inbox",
    noMatch: "No threads match this filter.",
    retry: "Try again",
    needsCheckingCount: (count: number) => `Needs checking ${String(count)}`,
    outlookHeading: "Outlook",
    outlookSteps: [
      "Open Settings, then Mail, then Rules, then Add new rule.",
      "Set the condition to From contains one of: Greenhouse, Lever, Ashby, Workable and Personio.",
      "Set the action to forward to your forwarding address, then save the rule.",
      "Outlook may ask you to confirm the forwarding address first. Follow the prompt it shows.",
    ],
    readOnly: "Read-only. Replies go from your own mailbox.",
    titleItalic: "inbox.",
    titlePlain: "Your ",
    unreadAria: "Unread",
    unreadCount: (count: number) => `Unread ${String(count)}`,
    unverifiedNote:
      "This mail did not pass the sender check, so Overture does not act on it: no codes are read from it and no stage moves. Check who sent it before you click a link or reply.",
    unverifiedTitle: "Couldn't verify sender.",
  },
  settings: {
    title: "Settings",
    lead: "Your account, and how Overture works for you",
    titlePlain: "Your",
    titleItalic: "Settings",
    limitsHeadingPlain: "How Overture",
    limitsHeadingItalic: "paces itself",
    limitsIntro:
      "The same limits for everyone, so your applications arrive one at a time and never as a burst.",
    limitDaily: "10 a day",
    limitDailyDetail:
      "At most ten applications a day. The count starts again at your local midnight.",
    limitWindow: "08:00 to 20:00",
    limitWindowDetail:
      "Applications go out only in daytime, your local time, at least 20 minutes apart.",
    limitCompany: "1 company per 30 days",
    limitCompanyDetail:
      "After an application to a company, Overture waits 30 days before applying there again.",
    limitRepost: "60 days",
    limitRepostDetail: "A role that is reposted is skipped for 60 days after you applied to it.",
    limitsFixed: "These limits are fixed. Nothing here can be turned up, down or off.",
    timeLanguageHeading: "Time and language",
    timeZoneLabel: "Time zone",
    timeZoneHint:
      "Your day, the 08:00 to 20:00 window and the midnight reset all follow this. A change takes effect after 7 days.",
    timeZoneToronto: "Eastern Time (Toronto)",
    timeZoneVancouver: "Pacific Time (Vancouver)",
    timeZoneBerlin: "Central European Time (Berlin)",
    languagesHeading: "Posting languages",
    languagesHint: "Overture only applies to postings written in these languages.",
    languagesGroup: "Posting languages",
    languageEnglish: "English",
    languageFrench: "French",
    languageGerman: "German",
    accountHeading: "Account and sign-in",
    providerNote: "Linking works when both sign-ins share the same verified email.",
    jobSearchAddress: "Job-search address",
    addressDetail: "Created with your mailbox in a later milestone. Read-only then.",
    magicLinkTitle: "Magic link",
    magicLinkDetail: "Always available. We email a one-time link, good for 15 minutes.",
    exportRow: "Export your data",
    exportRowDetail:
      "A zip of your profile, facts, Applications, messages, resume and attachments.",
    exportRowButton: "Export data",
    signOutThis: "Sign out of this device",
    signOutThisDetail: "Ends this session in this browser. Your other devices stay signed in.",
    signOutThisButton: "Sign out",
    signOutThisPending: "Signing out…",
    signOutThisError: "We could not sign you out. Check your connection and try again.",
    signOutAll: "Sign out all devices",
    signOutAllDetail: "Ends every session except this one.",
    signOutAllButton: "Sign out everywhere",
    signedOutMessage: "You are signed out on your other devices.",
    signedOutToasts: "Signed out everywhere",
    exportPage: {
      eyebrow: "— Settings",
      titlePlain: "Export your ",
      titleItalic: "data",
      lead: "A copy of what Overture holds about you",
      requestHeading: "Request",
      requestBody:
        "A zip of your profile, facts, Applications, messages, resume and attachments. The download link is valid for 24 hours.",
      requestButton: "Request export",
      preparingHeading: "Preparing",
      preparingPill: "Preparing",
      preparingBody: (requested: string) =>
        `Requested ${requested}. This can take a few minutes. We'll email you when it's ready to download.`,
      preparingButton: "Preparing your export",
      readyHeading: "Ready to download",
      readyPill: "Ready",
      readyBody: (expires: string) =>
        `The link is valid until ${expires}. After that, request a new export.`,
      readyButton: "Download export",
      expiredHeading: "Expired",
      expiredPill: "Expired",
      expiredBody: (expired: string) =>
        `The link expired on ${expired}. Nothing was lost: request a new export to get a fresh link.`,
      expiredButton: "Request export",
      failedHeading: "Request",
      failedBody:
        "This export could not be prepared. Nothing was lost: request a new export to try again.",
      replacedNote: "The earlier export was replaced, so its link no longer works.",
      downloading: "Preparing the download",
      downloadReady: "Export downloaded",
      downloadFailed: "The download did not finish. Please try again.",
      readme: (email: string, at: string) =>
        [
          "Overture export",
          "",
          `Account: ${email}`,
          `Made: ${at}`,
          "",
          "This zip holds your profile, facts, Applications, snapshots, messages,",
          "resume files and attachments. Files under files/ are the original",
          "documents; the JSON files describe them.",
          "",
          "The download was encrypted with the key in its link. Once it expires,",
          "the encrypted archive is deleted from Overture and a new request is needed.",
          "",
          "Questions or a problem: write to admin@tryoverture.com.",
          "",
        ].join("\n"),
    },
    legalHeading: "Terms and privacy",
    legalTerms: "Terms of Service",
    legalTermsDetail: "What Overture promises, and what you agree to.",
    legalPrivacy: "Privacy Policy",
    legalPrivacyDetail: "What Overture collects, who processes it and your rights.",
    legalConsent: "Consent",
    legalConsentVersion: (version: string) => `The version you agreed to: ${version}`,
    legalConsentAccepted: (date: string) => `Agreed ${date}`,
    legalConsentNotAgreed: "Not agreed yet.",
    legalConsentRead: "Read the consent",
    legalOpen: "Open",
    legalSeparator: " · ",
    notificationsHeading: "Notifications",
    notificationsIntro:
      "Turn the recap email or a kind of push off. Each switch takes effect at once.",
    recapTitle: "Recap email",
    recapDetail:
      "Yesterday’s applications sent, replies, open Reviews and check-ins, once each morning.",
    pushTitle: "Push notifications",
    pushIntro: "A push opens the app. Nothing is approved by a push or a link.",
    pushKinds: {
      ready: { label: "Ready to approve", detail: "Applications waiting for your approval." },
      review: { label: "New Review", detail: "A question that needs your answer." },
      reply: { label: "Employer reply", detail: "An employer wrote back to an application." },
      interview: { label: "Interview", detail: "An interview was detected." },
      offer: { label: "Offer", detail: "An offer was detected." },
      stage_move: { label: "Card moved", detail: "A card moved for you, with Undo." },
      code_wait: { label: "Code to paste", detail: "A verification code is waiting." },
      paused: { label: "Paused", detail: "Overture paused, with the reason." },
      failed: { label: "Couldn’t apply", detail: "Applications that could not be sent." },
    },
    notificationsSaveError: "We could not save that. Check your connection and try again.",
    calendarFeedHeading: "Calendar feed",
    calendarFeedIntro:
      "Subscribe in Google Calendar, Apple Calendar or Outlook to see your applications, Stage moves, Check-ins and interviews there.",
    calendarFeedPrivacy:
      "Anyone with the link can read the job titles, employers and Stages in it. Mail text and answers are never included.",
    calendarFeedOff: "The feed is off. Turn it on to get a link for your calendar app.",
    calendarFeedOn:
      "The feed is on. For your privacy, the link is shown only when it is made or rotated.",
    calendarFeedTurnOn: "Turn on feed",
    calendarFeedUrlLabel: "Calendar feed link",
    calendarFeedNewLink: "Copy the link now. You won’t see it again; rotate to get a new one.",
    calendarFeedHowTo: "In your calendar app, add a calendar from a URL and paste the link.",
    calendarFeedCopy: "Copy link",
    calendarFeedCopied: "Link copied",
    calendarFeedCopyFailed: "We could not copy the link. Select it and copy it by hand.",
    calendarFeedRotate: "Rotate link",
    calendarFeedRotateDetail: "Makes a new link. The current one stops working at once.",
    calendarFeedRevoke: "Turn off feed",
    calendarFeedRevokeDetail:
      "Calendar apps stop getting updates, and the link stops working at once.",
    calendarFeedPending: "Saving…",
    calendarFeedSaveError: "We could not save that. Check your connection and try again.",
    calendarFeedLoadError: "We could not load your calendar feed settings.",
    dangerHeading: "Danger zone",
    deleteTitle: "Delete account",
    deleteDetail: "Permanently deletes your facts, letters and applications. This can’t be undone.",
    deleteButton: "Delete account",
  },
  settingsBilling: {
    titlePlain: "Plan",
    titleItalic: "and billing",
    lead: "What you have left, when it renews, and how to change it",
    planHeading: "Your plan",
    weekPlan: "Week plan",
    monthPlan: "Month plan",
    weekDetail: "$12 for 70 Applications over 7 days. Renews every 7 days.",
    monthDetail: "$35 for 300 Applications over 30 days. Renews every 30 days.",
    leftHeading: "Applications left",
    leftOf: (total: number) => `of ${String(total)} this period`,
    renews: "Renews",
    noPlanTitle: "No plan yet.",
    noPlanDetail: "Choose a plan to prepare Applications for you to approve.",
    choosePlan: "Choose a plan",
    switchHeading: "Switch plan",
    switchDetail: (date: string) =>
      `A switch takes effect at renewal on ${date}. Applications you have not used expire at renewal. Plans do not roll over.`,
    switchToWeek: "Switch to Week at renewal",
    switchToMonth: "Switch to Month at renewal",
    cancelHeading: "Cancel plan",
    cancelDetail: (date: string) =>
      `Your plan stays on until ${date}. Overture prepares no Applications after that. Applications you have not used expire then.`,
    cancelButton: "Cancel at period end",
    paymentHeading: "Payment and invoices",
    paymentDetail: "Stripe hosts this page. Overture never sees your full card number.",
    managePayment: "Manage payment in Stripe",
    viewInvoices: "View invoices",
    unavailable: "Plan details are not available right now.",
    loading: "Loading your plan.",
    pricingLink: "See what each plan includes",
    portalError: "Stripe did not open. Try again in a moment.",
    billingOff: "Plan changes are not set up on this server yet.",
  },
  billingPlans: {
    backLink: "Plan and billing",
    titlePlain: "Choose",
    titleItalic: "a plan",
    lead: "Week or Month, for Applications you approve",
    weekName: "Week",
    monthName: "Month",
    weekPrice: "$12",
    monthPrice: "$35",
    weekUnit: "/ week",
    monthUnit: "/ month",
    weekDetail: "70 Applications over 7 days. Renews every 7 days. No rollover.",
    monthDetail: "300 Applications over 30 days. Renews every 30 days. No rollover.",
    chooseWeek: "Choose Week",
    chooseMonth: "Choose Month",
    startError: "Checkout did not open. Try again in a moment.",
    startedTitle: "Plan started",
    startedLine: (plan: string) => `${plan} plan on`,
    startedBody: (plan: string, applications: number, days: number) =>
      `Your ${plan} plan is on. ${String(applications)} Applications are ready for ${String(days)} days. Your first Applications are being prepared.`,
    goHome: "Go to Home",
    cancelledTitle: "Checkout not finished",
    cancelledLine: "No change",
    cancelledBody: "Nothing was charged. Your plan has not changed. Choose a plan to try again.",
    checkingTitle: "Checking the payment",
    checkingLine: "Checking with Stripe",
    checkingBody:
      "Stripe is still confirming the payment. This can take a minute. This page updates when it is confirmed.",
    unavailable: "Plan details are not available right now.",
  },
  settingsAccount: {
    tabsLabel: "Settings pages",
    tabs: {
      notifications: "Notifications",
      export: "Export",
      delete: "Delete account",
      supportAccess: "Support access",
      legal: "Terms and privacy",
      billing: "Plan and billing",
    },
    unavailable: "This page arrives with its own ticket.",
    viewLog: "View log",
    supportAccessRow: "Support access log",
    supportAccessDetail:
      "Each time support opens your account, it is recorded here with the reason.",
    supportAccessPage: {
      eyebrow: "— Settings",
      titlePlain: "Support",
      titleItalic: "access log",
      lead: "Every time support opened your account, and why",
      headingPlain: "Your",
      headingItalic: "entries",
      intro: "Each row is one Reveal of your data, with the date and the reason given.",
      actions: {
        "reveal.open": "Opened your account",
        "reveal.view": "Viewed your data",
        "reveal.close": "Closed the view",
        "reveal.expired": "Access expired",
      },
      reason: "Reason",
      emptyTitle: "No access so far.",
      emptyBody: "Nobody on the support team has opened your account.",
      errorTitle: "The log did not load.",
      errorBody: "Nothing was changed. Try again in a moment.",
      retry: "Try again",
    },
  },
  deleteAccount: {
    titlePlain: "Delete your",
    titleItalic: "account",
    lead: "Permanent, and it cannot be undone",
    steps: {
      warning: "Before you start",
      reauth: "Confirm it’s you",
      confirm: "Confirm",
      erasing: "Erasing",
      email: "Confirmation email",
    },
    warningHeading: "This erases everything",
    cannotUndo: "Deleting your account can’t be undone.",
    erasedIntro: "These are erased:",
    erasedItems: [
      "Your facts, resume and cover letters",
      "Every Application, its history and its messages",
      "Stored files and attachments",
      "Your saved preferences and push subscriptions",
    ],
    addressBold: "Your forwarding address is retired forever.",
    addressSample: "in-…@tryoverture.com",
    addressRest: "will never be given to anyone else, and it is never reused.",
    completes: "Erasing completes within 24 hours. You get a confirmation email when it is done.",
    continueToDelete: "Continue to delete",
    keepAccount: "Keep my account",
    reauthHeading: "Confirm it’s you",
    reauthBody:
      "Deleting needs a fresh sign-in. We email you a link that works once. Open it on this device, then come back here.",
    sendLink: "Email me a sign-in link",
    linkSent: "A sign-in link is on its way. Open it on this device, then come back here.",
    reauthenticated: "Confirmed. You can delete your account now.",
    confirmHeading: "Delete account",
    confirmCheckbox:
      "I understand my data is erased, and my forwarding address is retired forever.",
    deleteButton: "Delete my account",
    cancel: "Cancel",
    erasingHeading: "Erasing your account",
    erasingPill: "Erasing within 24 hours",
    erasingBody:
      "Your data is being erased now. It will be gone within 24 hours and this can’t be undone. You don’t need to do anything else.",
    emailHeading: "What arrives when it is done",
    emailFromLabel: "From",
    emailSubjectLabel: "Subject",
    emailFrom: "Overture <no-reply@tryoverture.com>",
    emailSubject: "Your Overture account has been deleted",
    emailHi: (name: string) => (name.trim() === "" ? "Hi," : `Hi ${name.trim()},`),
    emailBody:
      "Your Overture account and its data have been erased. Your forwarding address is retired and will not be used again.",
    emailContact: "If you didn’t ask for this, write to admin@tryoverture.com as soon as you can.",
    emailSignoff: "Overture",
    errors: {
      unauthorised: "Sign in again, then come back to this page.",
      reauthRequired: "Confirm it’s you before deleting the account.",
      linkFailed: "The sign-in link did not go out. Try again.",
      deleteFailed: "The account could not be deleted. Try again.",
      tooMany: "Too many tries. Wait a few minutes and try again.",
      confirmRequired: "Tick the box to confirm you understand what is erased.",
    },
  },
  profile: {
    sectionsLabel: "Profile sections",
    lead: "The facts Overture applies with",
    titlePlain: "Your",
    titleItalic: "Profile",
    tabs: {
      resume: "Resume",
      facts: "Your facts",
      targets: "Targets",
      skipList: "Skip list",
      address: "Job-search address",
    },
    resume: {
      sub: "One resume, sent exactly as you uploaded it.",
      previewLabel: "Preview of the first page of Maya_Okafor_Resume.pdf",
      pageOf: "Page 1 of 2",
      chip: "PDF",
      fileName: "Maya_Okafor_Resume.pdf",
      meta: "Uploaded 3 Nov 2026 · 2 pages · 184 KB",
      strongNote: "Sent unchanged with every application",
      note: "Overture attaches this exact file. It never edits, restyles or rewrites it. Only the cover letter is written for each role, and it only says what your resume supports.",
      sentWith: "Sent with",
      sentWithValue: "22 applications",
      factsRead: "Facts read from it",
      factsReadValue: "9, each confirmed by you",
      replace: "Replace resume",
      download: "Download PDF",
      newFileNote:
        "A new file applies to applications sent from now on. Applications already sent keep the version they went out with.",
    },
    facts: {
      intro:
        "What Overture answers forms with, word for word. A question it cannot answer from these becomes a Review.",
      titlePlain: "Your",
      titleItalic: "facts",
      tiersLabel: "Facts by tier",
      tier1: {
        label: "Tier 1 · Needed to start",
        count: "17 of 17",
        note: "Confirmed before Overture began. Eight of seventeen are shown; open any fact to edit it.",
        foot: "Nine more Tier 1 facts are confirmed: phone, city, country, LinkedIn, years of experience, degree, employment history, education history and languages.",
        rows: [
          {
            kind: "serif",
            label: "Legal name",
            value: "Maya Okafor",
            chip: "fromResume",
            note: "Used in 22 applications",
            action: "edit",
          },
          {
            label: "Job-search address",
            kind: "mono",
            value: "maya.okafor@mail.tryoverture.com",
            chip: "assigned",
            note: "Read-only. Never your sign-in email.",
            action: "read-only",
          },
          {
            kind: "serif",
            label: "Work authorization",
            value: "Canada: authorized. United States: not authorized.",
            chip: "typed",
            note: "Used in 23 applications",
            action: "edit",
          },
          {
            kind: "serif",
            label: "Sponsorship required",
            value: "Canada: no. United States: yes.",
            chip: "typed",
            note: "Used in 21 applications",
            action: "edit",
          },
          {
            kind: "serif",
            label: "Notice period",
            value: "Two weeks",
            chip: "typed",
            note: "Used in 9 applications",
            action: "edit",
          },
          {
            kind: "serif",
            label: "Salary expectation",
            value: "USD 110,000 to 128,000",
            chip: "typed",
            note: "Used in 12 applications",
            action: "edit",
          },
          {
            kind: "serif",
            label: "Willing to relocate",
            value: "Yes, within Canada",
            chip: "typed",
            note: "Used in 9 applications",
            action: "edit",
          },
          {
            kind: "serif",
            label: "Current employer",
            value: "Brightwave Analytics",
            chip: "fromResume",
            note: "Also on your Skip list",
            action: "edit",
          },
        ],
      },
      tier2: {
        label: "Tier 2 · Strengthen your profile",
        count: "2 of 5",
      },
      tier3: {
        label: "Tier 3 · Learned from Reviews",
        count: "3",
      },
      strengthen: {
        empty:
          "Nothing to add right now. When a question cannot be answered from your facts, it appears here with the number of queued applications it unlocks.",
        unlocks: (count: number) =>
          `Unlocks ${String(count)} queued ${plural(count, "application", "applications")}`,
        note: "Optional. Each fact answers common questions, so the queued applications waiting on them can go ahead.",
        foot: "Facts you add here are used on every application that asks.",
        save: "Save fact",
        saveAria: (label: string) => `Save fact: ${label}`,
        saving: "Saving",
      },
      fromResume: "From your resume",
      typedHere: "Typed here",
      assignedBy: "Assigned by Overture",
      readOnly: "Read-only",
      edit: "Edit",
      aria: (label: string, action: string) => `${action}: ${label}`,
      remove: (label: string) => `Remove ${label}`,
    },
    targets: {
      intro: "Overture only scores postings that fit these.",
      titlePlain: "Your",
      titleItalic: "targets",
      matchedValue: "213",
      matchedLabel: "open postings match your targets",
      matchedNote:
        "Counted live from the postings Overture has read. Change a target and the number changes with it.",
      roles: "Roles",
      role: "Platform Engineer",
      role2: "Senior Backend Engineer",
      role3: "DevOps Engineer",
      role4: "Infrastructure Engineer",
      role5: "Site Reliability Engineer",
      addRole: "Add role",
      add: "Add",
      locations: "Locations",
      location1: "Toronto, ON",
      location2: "Vancouver, BC",
      location3: "Austin, TX",
      addLocation: "Add location",
      workplace: "Workplace",
      remote: "Remote",
      remoteOn: true,
      hybrid: "Hybrid",
      hybridOn: true,
      onSite: "On-site",
      onSiteOn: false,
      seniority: "Seniority",
      mid: "Mid",
      midOn: false,
      senior: "Senior",
      seniorOn: true,
      staff: "Staff",
      staffOn: true,
      lead: "Lead",
      leadOn: false,
      employmentType: "Employment type",
      fullTime: "Full-time",
      fullTimeOn: true,
      partTime: "Part-time",
      partTimeOn: false,
      contract: "Contract",
      contractOn: false,
      currencyLabel: "Currency",
      currencyCad: "CAD",
      currencyUsd: "USD",
      salaryFloor: "Salary floor",
      salaryFloorValue: "140,000",
      salaryFloorUnit: "a year",
      salaryFloorNote: "Postings that state a lower salary are skipped.",
      submit: "Save targets",
      submitNote: "Changes apply to postings Overture finds from now on.",
    },
    skipList: {
      intro:
        "Companies Overture never applies to. Your current employer is on it from the start, read from your resume.",
      titlePlain: "Skip",
      titleItalic: "list",
      company1: "Brightwave Analytics",
      currentEmployer: "Current employer",
      company2: "Quillon Payments",
      company3: "Fenwick & Marsh",
      addLabel: "Add a company to skip",
      add: "Add",
      note: "A skipped company never gets an application, even when a posting there is a Strong match. Your current employer stays on the list.",
    },
    address: {
      intro:
        "The email on every application form. Employers reply to it, and the replies appear in your Inbox.",
      titlePlain: "Job-search",
      titleItalic: "address",
      alias: "maya.okafor@mail.tryoverture.com",
      chip: "Read-only",
      onEveryForm: "On every form",
      onEveryFormValue: "This address. Your sign-in email is never used.",
      repliesTo: "Replies go to",
      repliesToValue: "Your Inbox",
      changeNote: "The address can only be changed through support.",
    },
  },
  ready: {
    titlePlain: "Ready to",
    titleItalic: "send",
    lead: "Overture filled these in. Nothing is sent until you press Send.",
    dateLocale: "en-US",
    summary: (ready: number, approved: number) =>
      `${String(ready)} ready · ${String(approved)} approved`,
    sendAll: "Send all",
    dot: "·",
    sentToday: (sent: number, cap: number) => `${String(sent)} of ${String(cap)} sent today`,
    resume: (filename: string) => `Resume: ${filename}`,
    answers: (count: number) => `${String(count)} ${plural(count, "answer", "answers")}`,
    showAnswers: "Show answers",
    hideAnswers: "Hide answers",
    showAnswersAria: (company: string) => `Show answers, ${company}`,
    send: "Send",
    skip: "Skip",
    undo: "Undo",
    approved: "Approved",
    sendingAround: (time: string) => `Approved · sending around ${time}`,
    approvedNoSlot: "Approved",
    coverLetter: "Cover letter · preview",
    formChangedNote: "If the form has changed when we send, we stop and ask you first.",
    noPlan: "The plan is not ready to show yet.",
    edit: "Edit",
    editAria: (label: string) => `Edit answer: ${label}`,
    editLabel: (label: string) => `Your answer to ${label}`,
    save: "Save",
    cancel: "Cancel",
    dismiss: "Dismiss",
    saving: "Saving…",
    emptyTitle: "Nothing to approve right now.",
    emptyBody: "New applications appear here before anything is sent.",
    loading: "Loading your Ready list",
    loadFailedTitle: "Ready could not load.",
    loadFailedBody: "Nothing has been sent. Try again in a moment.",
    staleWarning: "Could not refresh Ready. The cards below may be out of date.",
    retry: "Try again",
    retrying: "Trying again…",
    changesTitle: "What changed",
    source: {
      fact: "Fact",
      review: "Review",
      resume: "Resume",
    },
    toast: {
      approved: "Approved. It sends in its slot.",
      approvedAll: (count: number) =>
        `${String(count)} ${plural(count, "application", "applications")} approved.`,
      unapproved: "Back in Ready. Nothing is sent until you press Send.",
      skipped: "Skipped. It left the Board.",
      saved: "Answer saved.",
      planChanged: "The plan changed. The card reloaded; review it and press Send again.",
      refused: (count: number) =>
        `${String(count)} ${plural(count, "card", "cards")} could not be approved.`,
      failed: "That did not go through. Try again.",
    },
  },
  board: {
    lead: (applications: number) =>
      `${capitalize(countWord(applications))} ${applications === 1 ? "application" : "applications"} across six stages`,
    titlePlain: "Your",
    titleItalic: "Board",
    searchLabel: "Search the board",
    filter: "Filter",
    running: "Running",
    paused: "Paused",
    start: "Start",
    pause: "Pause",
    stagesLabel: "Stages",
    columns: {
      queued: "Queued",
      ready: "Ready",
      applied: "Applied",
      screening: "Screening",
      interviewing: "Interviewing",
      offer: "Offer",
      closed: "Closed",
    },
    more: (count: number, stage: string) => `${String(count)} more ${stage.toLowerCase()}`,
    openCard: (title: string, company: string) => `Open ${title} at ${company}`,
    keyboardHint: "Press the left or right arrow key to move this card to another stage.",
    moveTo: (title: string, stage: string) => `Move ${title} to ${stage}`,
    moved: (stage: string) => `Moved to ${stage}`,
    undo: "Undo",
    checking: "Checking with the employer",
    sheetLabel: "Application detail",
    closeDetail: "Close detail",
    previousCard: "Previous card",
    nextCard: "Next card",
    grabHandle: "Drag to resize or close detail",
    reference: (reference: string) => `Application ${reference}`,
    openPosting: "Open original posting",
    moveStage: "Move stage",
    archive: "Archive",
    archiveNote: "Archiving withdraws this application. It leaves the Board.",
    archiveOnlyQueued: "Only a queued application can be archived.",
    sectionsLabel: "Application sections",
    tabs: {
      timeline: "Timeline",
      answers: "Answers",
      cover: "Cover letter & resume",
      emails: "Emails",
    },
    salary: (minimum: string, maximum: string | null, currency: string, suffix: string) =>
      maximum === null
        ? `${currency} ${minimum}${suffix}`
        : `${currency} ${minimum}–${maximum}${suffix}`,
    send: "Send",
    match: (score: number) => `Match ${String(score)}`,
    matchLabel: "Match",
    loadingDetail: "Loading the application…",
    emptyColumn: "No applications here yet.",
    timeline: {
      found: "Found",
      scored: (score: number) => `Scored ${String(score)}`,
      foundBody: (company: string) => `Posting found on the ${company} career board.`,
      prepared: "Prepared",
      needsReview: "Waiting on a Review",
      checked: "Checked",
      submitted: "Submitted",
      confirming: "Checking with the employer",
      confirmed: "Confirmed",
      couldNotApply: "Couldn't apply",
      skipped: "Skipped",
      withdrawn: "Withdrawn",
      moved: (stage: string) => `Moved to ${stage}`,
      email: "Reply received",
      checkin: "Check-in",
      note: "Note",
      empty: "Nothing has happened yet.",
    },
    answers: {
      title: "What was sent",
      empty: "Nothing was sent, so there are no answers to show.",
      noSnapshot: "This application has not been sent yet.",
      label: "Question",
      fromResume: "From your resume",
      fromSaved: "From your saved facts",
      typedHere: "Typed here",
    },
    cover: {
      title: "The letter and the file",
      empty: "No letter was sent with this application.",
      noSnapshot: "This application has not been sent yet.",
      resume: "Resume file",
      hash: "SHA-256",
      lines: (count: number) => (count === 1 ? "1 resume line" : `${String(count)} resume lines`),
    },
    emails: {
      title: "Linked mail",
      empty: "No mail is linked to this application yet.",
      from: "From",
    },
    states: {
      checking: "Checking with the employer",
      needsYou: "Needs you",
      sentToday: "Sent today",
      sent: "Sent",
      sendsAbout: (time: string) => `Sends about ${time}`,
    },
  },
  review: {
    lead: (questions: number, applications: number) =>
      `${capitalize(countWord(questions))} questions, ${countWord(applications)} applications waiting`,
    title: "Your",
    titleAccent: "Review",
    filters: "Filter questions",
    all: "All",
    groupMany: "Unlocks 3 or more jobs",
    groupFew: "Unlocks 1 or 2 jobs",
    listTitle: "Waiting for you",
    listNote: "Answer once, and every application waiting on it moves forward",
    groupedBy: "Grouped by jobs unlocked",
    unlocked: (count: number) => (count === 1 ? "job unlocked" : "jobs unlocked"),
    needsYou: "Needs you",
    questionOf: (position: number, total: number) =>
      `Question ${String(position)} of ${String(total)}`,
    detailNote: (count: number) =>
      `${capitalize(countWord(count))} postings ask this. Nothing on your resume or in your saved facts says either way, so Overture will not guess.`,
    unlocks: "Unlocks",
    jobs: "jobs",
    askedBy: "Asked by",
    companies: "companies",
    queued: "Queued, waiting on this answer",
    closestFact: "Closest fact on file",
    closestFactNote:
      "Nothing in your resume or your saved facts answers this question. Answer it once and Overture reuses it for every application that asks.",
    closestFactKnown: (label: string) =>
      `${label} is on file. Confirming it here updates the fact for every form that asks.`,
    answerPlaceholder: "Type your answer",
    checkboxYes: "Yes",
    yourAnswer: "Your answer",
    answerNote:
      "Saved as a fact and reused whenever a form asks this. Posting text never answers it for you.",
    save: (count: number) =>
      `Save answer · unlocks ${String(count)} ${count === 1 ? "job" : "jobs"}`,
    dismiss: "Dismiss",
    dismissNote: (count: number) =>
      `Dismissing skips these ${String(count)} applications. They leave the Board.`,
    back: "All questions",
    emptyTitle: "Nothing is waiting for you",
    emptyBody: "When a form asks something your Facts cannot answer, it waits here.",
    categories: {
      availability: "Availability",
      experience: "Experience",
      work_authorization: "Work authorization",
      links: "Links",
      languages: "Languages",
      identity: "Identity",
      eeo: "EEO",
      other: "Other",
    },
  },
  onboarding: {
    stepsLabel: "Setup steps",
    setupTitlePlain: "Set up your",
    setupTitleItalic: "workspace",
    setupIntro: "Five short steps. Each one saves as you go, so you can stop and come back.",
    steps: ["Sign in", "Resume", "Your facts", "What you want", "Forwarding & start"],
    factsStepLabels: ["Sign in", "Resume", "Your facts", "What you want", "Address & start"],
    stepPosition: (step: number, total: number) => `Step ${String(step)} of ${String(total)}`,
    stepSeparator: "·",
    welcomeTitlePlain: "Welcome to",
    welcomeTitleItalic: "Overture",
    welcomeIntro: "Here is what happens next, in three steps.",
    welcomePoints: [
      {
        body: "It reads new postings every day and keeps the ones that fit what you are looking for.",
        title: "Overture finds jobs",
      },
      {
        body: "Answers come only from your own facts. Anything it cannot answer waits for you in Review.",
        title: "It prepares every application",
      },
      {
        body: "Nothing is sent until you have read it and said yes.",
        title: "You approve, then it goes",
      },
    ],
    resumeTitlePlain: "Upload your",
    resumeTitleItalic: "resume",
    resumeIntro:
      "Upload one PDF. Overture sends it byte-for-byte, never rewritten, reformatted or re-typed.",
    resumeLabel: "Resume",
    resumeRequired: "Required to continue",
    resumeChoose: "Upload a PDF",
    resumeDropHint: "Drag it here. One PDF, up to 10 MB.",
    resumeReplace: "Replace file",
    resumeKept: "Kept exactly as you sent it. The copy Overture stores is this file, unchanged.",
    resumeReads:
      "Overture reads contact details, roles, dates and skills from it. You check them on the next step.",
    resumeUnreadable:
      "Overture couldn't read this PDF. Replace it, or continue and type your facts yourself on the next step.",
    resumeUploadFailed: "That upload did not work. Try a PDF under 10 MB.",
    resumeMeta: (pages: number, size: string) =>
      `PDF · ${String(pages)} ${plural(pages, "page", "pages")} · ${size}`,
    resumeSize: (bytes: number) =>
      bytes < 1024 * 1024
        ? `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
        : `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
    uploadedToday: "Uploaded today",
    uploadedYesterday: "Uploaded yesterday",
    uploadedOn: (date: string) => `Uploaded ${date}`,
    cardTitlePlain: "Your",
    cardTitleItalic: "facts",
    cardIntro:
      "These are the questions that would otherwise stop an application and wait for you in Review. Answer what you can now.",
    note: "Overture uses these answers only when a form asks for them, never guessed.",
    jobTitle: "Current job title",
    jobTitleAutocomplete: "organization-title",
    workAuth: "Work authorisation",
    workAuthHint: "One answer for each country you are applying from. Pick what is true there.",
    workAuthFor: (country: string) => `Work authorisation in ${country}`,
    workAuthOptions: ["Citizen", "Permanent resident", "Work permit", "Need sponsorship"],
    choose: "Choose",
    salary: "Salary expectation",
    salaryHint: "One figure for each currency you are paid in. Forms ask for it in that currency.",
    salaryFor: (currency: string) => `Salary expectation in ${currency}`,
    salaryPeriodFor: (currency: string) => `Period for ${currency}`,
    salaryAmount: "Amount",
    hear: "How did you hear about us?",
    hearOptional: "Optional",
    hearPlaceholder: "For example, a friend or a job board",
    eeo: "Voluntary self-identification",
    eeoHint:
      "Off by default. Turn it on only if you want forms to use these answers. Every field can stay at Prefer not to say.",
    eeoSwitch: "Share EEO answers with forms",
    eeoFields: {
      gender: "Gender",
      ethnicity: "Ethnicity",
      veteran: "Veteran status",
      disability: "Disability status",
    },
    eeoOptions: {
      gender: ["Prefer not to say", "Woman", "Man", "Non-binary"],
      ethnicity: [
        "Prefer not to say",
        "Asian",
        "Black",
        "Hispanic or Latino",
        "White",
        "Two or more",
      ],
      veteran: ["Prefer not to say", "Not a veteran", "Veteran"],
      disability: ["Prefer not to say", "No", "Yes"],
    },
    wantTitlePlain: "What do you",
    wantTitleItalic: "want?",
    wantIntro:
      "These decide which postings are scored and where. You can change them later in your Profile.",
    atLeastOne: "At least one",
    roles: "Roles",
    cities: "Cities and countries",
    addLocationPlaceholder: "Add a city or country",
    workplace: "Workplace",
    seniority: "Seniority",
    salaryFloor: "Salary floor",
    salaryFloorUnit: "a year",
    salaryFloorNote: "Postings that state a lower salary are skipped.",
    companiesToSkip: "Companies to skip",
    addCompanyPlaceholder: "Add a company",
    companiesToSkipNote: "Nothing is prepared for these companies. You can leave this empty.",
    matchedLabel: "open postings match your targets",
    matchedNote: "Sample count. It updates as you change the choices above.",
    add: "Add",
    unlocks: (count: number) => `Unlocks ${String(count)} queued ${plural(count, "job", "jobs")}`,
    answered: "Answered",
    notAnswered: "Not answered",
    answeredOf: (done: number, total: number) => `${String(done)} of ${String(total)} answered`,
    skipNote: "Skip anything. Unanswered questions wait in Review.",
    back: "Back",
    continue: "Continue",
    trial: {
      stepLabel: "Trial card",
      eyebrow: "Overture · Set up",
      titlePlain: "Verify a card for your",
      titleItalic: "three",
      titleRest: "free Applications",
      kicker: "One free trial per card",
      stepPill: "Step 6 of 6",
      verifyTitle: "Verify a card",
      intro:
        "Stripe checks the card. Nothing is charged for the trial. Once it is verified, Overture prepares your first 3 free Applications and you approve each one before it is sent. One free trial per card.",
      verifyButton: "Verify card",
      verifying: "Checking the card…",
      backButton: "Back",
      declinedTitle: "Card declined",
      declinedBody:
        "Your bank declined this card. Nothing was charged and no Applications were prepared. Try another card, or choose a plan.",
      tryAnother: "Try another card",
      usedHeading: "Card already used",
      usedTitle: "Trial used",
      usedBody:
        "This card has already had its free trial. Choose a plan to prepare Applications with it, or use another card.",
      choosePlan: "Choose a plan",
      anotherCard: "Use another card",
      startButton: "Start",
      loadFailed: "The card check did not go through. Try again in a moment.",
    },
    forward: {
      titlePlain: "Forward your",
      titleItalic: "job mail",
      intro:
        "Employers and job sites write to you through their hiring systems. Forward only those messages to Overture. Your own inbox stays yours.",
      addressLabel: "Your forwarding address",
      copy: "Copy",
      copied: "Copied",
      copyLabel: "Copy forwarding address",
      addressNote:
        "Use this only as the place mail is forwarded to. Never type it on a job application.",
      loadFailed: "Your forwarding address did not load. Reload the page to try again.",
      filterTitle: "Set up one Gmail filter",
      stepOne: {
        before: "In Gmail, open Settings, then ",
        bold: "Filters and Blocked Addresses",
        between: ", then ",
        boldEnd: "Create a new filter",
        after: ".",
      },
      stepTwo: {
        before: "In ",
        bold: "From",
        after: ", paste these job-site domains. Leave every other field empty.",
      },
      stepThree: {
        before: "Tick ",
        bold: "Forward it to",
        after:
          ", choose your forwarding address above, then create the filter. Gmail confirms the address with Overture automatically.",
      },
      checkTitle: "Check it works",
      waiting:
        "Waiting for a test email. Send one to your address from a job site, or forward any message from that domain list.",
      testSubject: "Overture forwarding test",
      sendTest: "Send a test email",
      received: "Received. Your filter works, and Overture will show job mail in your Inbox.",
      skipNote:
        "Cannot set up a filter? Overture sends a notification instead, and you paste each code within ten minutes.",
      agreeBefore: "I agree to the ",
      terms: "Terms",
      agreeBetween: " and the ",
      privacy: "Privacy Policy",
      agreeAfter:
        ". Overture prepares applications from my facts and sends only the ones I approve.",
      firstRun:
        "Overture prepares your first applications at 07:00 tomorrow. Nothing is sent until you approve.",
      tickToStart: "Tick the box to start.",
      start: "Start",
      starting: "Starting",
      startFailed: "That did not work. Try Start again.",
    },
    signOut: "Sign out",
    saveFailed: "That did not save. Try again.",
    loading: "Loading…",
    loadFailedTitle: "That did not load",
    loadFailedBody: "Overture could not load this step. Try again; your answers so far are saved.",
    retry: "Try again",
    retrying: "Trying again…",
    emptyTargetsTitle: "Nothing to choose from yet",
    emptyTargets:
      "Overture has no open postings to match against yet. Try again in a few minutes; your answers so far are saved.",
  },
  notifications: {
    page: {
      title: "Notifications",
      today: "Today",
      earlier: "Earlier",
      markAll: "Mark all as read",
      emptyTitle: "Nothing yet.",
      emptyBody:
        "Overture will list the daily recap, replies, interviews and anything that needs you here, as each push arrives.",
      emptyAction: "Notification settings",
      footer: "Each push you turn on is listed here too. Turn kinds on or off in ",
      settings: "Settings",
      unread: "Unread",
      actions: {
        alert: "Open Home",
        code_wait: "Paste code",
        failed: "Open Home",
        interview: "Open Inbox",
        offer: "Open Inbox",
        paused: "Open Home",
        ready: "Open Ready",
        reply: "Open Inbox",
        review: "Open Review",
        stage_move: "Undo",
      },
    },
    push: {
      enable: "Turn on notifications",
      enableDetail:
        "Push works only from the app on your home screen on most phones. Your browser asks once.",
      enabled: "Notifications are on for this device.",
      enabledDetail: "Overture can send the recap and the rest to this device.",
      disable: "Turn off notifications",
      denied: "Notifications are blocked in your browser. Allow them in your browser settings.",
      unsupported: "This browser cannot receive notifications.",
      failed: "That did not work. Try again.",
      thisDevice: "Notifications on this device",
    },
    codeWait: {
      title: (company: string) => `${company} needs a code`,
      body: (minutes: number) =>
        `The form asked for a code sent to your email. Paste it in Overture within ${countWord(minutes)} minutes, or the Application ends and can be tried again later.`,
      url: "/",
      kind: "code_wait",
    },
    stageMove: {
      title: (stage: string) => `Moved to ${stage}`,
      body: (input: { company: string; title: string; stage: string }) =>
        `${input.title} at ${input.company} is now in ${input.stage}. Open the Board to undo it.`,
      url: "/board",
      kind: "stage_move",
    },
    review: {
      title: "A question for you",
      body: "Open Review to answer it so these applications can go ahead.",
      url: "/review",
      kind: "review",
    },
    reply: {
      title: (company: string) => `${company} replied`,
      body: (title: string) => `About ${title}. Read it in Inbox.`,
      url: "/inbox",
      kind: "reply",
    },
    interview: {
      title: (company: string) => `Interview request: ${company}`,
      body: (title: string) => `${title}. Open the thread in Inbox to see the details.`,
      url: "/inbox",
      kind: "interview",
    },
    offer: {
      title: (company: string) => `Offer from ${company}`,
      body: (title: string) =>
        `${title}. Open the thread in Inbox to see the details and what comes next.`,
      url: "/inbox",
      kind: "offer",
    },
    paused: {
      url: "/",
      kind: "paused",
    },
    failedSummary: {
      title: (count: number) =>
        count === 1
          ? "Couldn't apply to 1 application"
          : `Couldn't apply to ${String(count)} applications`,
      body: (window: string) => `Between ${window}. Open Home to see why each one stopped.`,
      url: "/",
      kind: "failed",
    },
    noResponse: {
      title: "Closed as No response",
      body: (input: { company: string; title: string }) =>
        `${input.title} at ${input.company} had no reply after 45 days, so it moved to Closed. Open the Board to undo it.`,
      url: "/board",
      kind: "stage_move",
    },
  },
  codePaste: {
    grabHandle: "Close the code-paste sheet",
    close: "Close",
    eyebrow: "Code paste",
    waiting: {
      titlePlain: "Paste the",
      titleItalic: "code.",
      body: "The email with the code can take a minute. Paste it here, and Overture submits the form again.",
      primary: "Submit code",
      secondary: "No code yet",
    },
    noCode: {
      titlePlain: "Still",
      titleItalic: "waiting.",
      body:
        "No code has arrived in your forwarded mail yet. Overture keeps checking until the timer ends. " +
        "Look in spam, and check the filter if mail has not come through at all.",
      primary: "Submit code",
      secondary: "Check the filter guide",
    },
    expired: {
      titlePlain: "The code",
      titleItalic: "never arrived.",
      body:
        "The verification code never arrived, so nothing was sent. The Application ends here and can be " +
        "tried again later from Board.",
      pill: "Window closed",
      primary: "Back to Home",
      secondary: "Open Board",
    },
    accepted: {
      titlePlain: "Submitted",
      titleItalic: "with your code.",
      body: (company: string) =>
        `Overture submitted the form with your code. ${company} has not confirmed receipt yet, so the ` +
        "Application stays in Checking with the employer until it does.",
      pill: "Code accepted",
      checking: "Checking with the employer",
      primary: "Back to Home",
      secondary: "Open Board",
    },
    label: "Verification code",
    placeholder: "8 characters",
    timeLeft: "Time left",
    invalid: "Enter the 8-character code from the email.",
    errors: {
      expired: "That wait has closed, so nothing was sent. Try the Application again from Board.",
      notFound: "That wait is no longer open.",
      failed: "The code did not go through. Try again.",
    },
  },
  placeholder: {
    lead: "Coming in a later slice",
    board: "Board",
    boardNote: "Applications appear here once Overture has a catalog to apply from.",
    review: "Review",
    reviewNote: "Questions Overture cannot answer would wait for you here.",
    inbox: "Inbox",
    inboxNote: "Replies from employers would land here.",
    profile: "Profile",
    profileNote: "Your resume, facts and targets live here.",
    emptyHeadingNote: "Overture will build this screen next.",
  },
  notFound: {
    title: "Not found",
    body: "This page does not exist yet.",
  },
  search: {
    title: "Search",
    eyebrow: "Find a role",
    placeholder: "Search by title, company, location or department",
    submit: "Search",
    resultsHeading: "Postings",
    empty: "No postings match that search.",
    pending: "Searching…",
    via: "via",
    filters: {
      heading: "Filters",
      role: "Role",
      seniority: "Seniority",
      workplace: "Workplace",
      location: "City",
      employmentType: "Employment type",
      allRoles: "All roles",
      allSeniorities: "All levels",
      allWorkplaces: "All workplaces",
      allLocations: "Any city",
      allEmploymentTypes: "All employment types",
      workplaces: {
        remote: "Remote",
        hybrid: "Hybrid",
        onsite: "Onsite",
        unknown: "Unspecified",
      },
      seniorities: {
        intern: "Intern",
        entry: "Entry",
        mid: "Mid",
        senior: "Senior",
        staff: "Staff",
        principal: "Principal",
        manager: "Manager",
        director: "Director",
      },
      employmentTypes: {
        full_time: "Full-time",
        part_time: "Part-time",
        contract: "Contract",
        internship: "Internship",
        temporary: "Temporary",
        unknown: "Unspecified",
      },
    },
  },
  admin: {
    area: "Overture admin",
    brandAria: "Overture admin",
    navLabel: "Admin sections",
    navOverview: "Overview",
    navSwitches: "Kill switches & settings",
    navCatalog: "Catalog health",
    navGrants: "Grants",
    navBilling: "Billing",
    billingCrumb: "Admin / Billing",
    billingSections: "Billing sections",
    marginEyebrow: "Measured from real Applications",
    marginTitle: "Cost and margin",
    marginLead:
      "Per Application, per plan, last 30 days. Measured cost against what each plan earns.",
    billingTabUsers: "Users",
    billingTabRefunds: "Refunds",
    billingTabReconciliation: "Reconciliation",
    billingTabMargin: "Cost and margin",
    marginPlanHeading: "Per plan",
    marginWindow: "Last 30 days",
    marginColumnPlan: "Plan",
    marginColumnPrice: "Price",
    marginColumnApplications: "Applications",
    marginColumnCost: "Cost per Application",
    marginColumnRevenue: "Revenue per Application",
    marginColumnMargin: "Margin per Application",
    marginColumnGate: "Margin and gate",
    marginPlanName: { trial: "Trial", week: "Week", month: "Month" },
    marginApplicationsCount: (count: number) => `${String(count)} Applications`,
    marginNotMeasured: "n/a",
    marginSeparator: " · ",
    marginShortCost: "Cost",
    marginShortRevenue: "Revenue",
    marginShortMargin: "Margin",
    marginGateOver: (gate: string) => `Over ${gate}`,
    marginGateUnder: (gate: string) => `Under ${gate}`,
    marginNoData: "No Application has been sent in the last 30 days yet.",
    marginHowTitle: "How to read it",
    marginHowBody:
      "Cost is the measured cost of one completed Application: browser time, proxy bytes and model calls, averaged over 30 days. Revenue is the plan price divided by its Applications. The trial has no revenue, so its margin is its full cost. The gate is the $0.03 target in the admin Overview.",
    marginBesideHeading: "Reported beside, not inside",
    marginBesideBody:
      "Fixed infrastructure, mail and the model calls for tagging, inbox and resumes sit outside cost per Application.",
    marginBesideInfra: "Fixed infrastructure a month",
    marginBesideMail: "Mail this month",
    marginBesideMailOverage: (sends: number, included: number) =>
      `${String(sends)} sent, ${String(included)} included`,
    marginBesideOther: "Other model calls, last 30 days",
    overviewTitlePlain: "The admin",
    overviewTitleItalic: "overview",
    overviewLead: "What Overture is doing right now",
    overviewUsers: "Users",
    overviewOwners: "Owners",
    overviewSessions: "Sessions",
    overviewSwitches: "Kill switches switched off",
    overviewMail: "Email sending",
    overviewMailSent: "Sent this month",
    overviewMailCap: "Monthly cap",
    overviewMailReserve: "Kept for sign-in mail",
    overviewMailNote: (cap: number, reserve: number) =>
      `Sends stop at ${cap.toLocaleString("en-US")}; the last ${reserve.toLocaleString("en-US")} are kept for sign-in mail and the live check, so notices stop first.`,
    overviewMailRefused: "Sending is stopped for this month.",
    overviewMailReservePaused:
      "Notices are paused for this month; sign-in mail and the live check still go.",
    overviewJobs: "Background jobs",
    overviewJobsEmpty: "No background jobs yet.",
    overviewAudit: "Recent admin actions",
    overviewAuditEmpty: "No admin actions have been recorded yet.",
    overviewCost: "Cost and proxy",
    overviewCostIntro: "Every finished send try counts toward this, failed tries included.",
    overviewCostCompleted: "Completed Applications",
    overviewCostProxy: "Proxy MB per completed Application",
    overviewCostPerApplication: "Cost per completed Application",
    overviewCostGate: (cost: string, gate: string) => `${cost} against the ${gate} gate`,
    overviewCostGateMet: "Inside the gate",
    overviewCostGateMissed: "Over the gate",
    overviewCostEmpty: "No completed Applications yet.",
    overviewCostTrend: "Proxy use per completed Application is trending up.",
    overviewCostNoTrend: "Proxy use per completed Application is steady.",
    navProviderReport: "Provider report",
    reportTitlePlain: "The provider",
    reportTitleItalic: "report",
    reportLead: "How each browser and job board is doing, and what the lab measured",
    reportSendHeading: "Send results",
    reportSendIntro:
      "Every send try, per browser and job board. Cost counts attempted Applications, failed tries included.",
    reportSendEmpty: "No send has run yet.",
    reportLabHeading: "The synthetic lab",
    reportLabIntro:
      "Sessions against Overture's own challenge pages and recorded forms. No employer is involved, and the lab's cost is reported beside the gate, not inside it.",
    reportLabEmpty: "The lab has not run yet.",
    reportColumnBrowser: "Browser",
    reportColumnJobBoard: "Job board",
    reportColumnPage: "Lab page",
    reportColumnAttempted: "Attempted",
    reportColumnSessions: "Sessions",
    reportColumnCompleted: "Completed",
    reportColumnCompletion: "Completion",
    reportColumnChallenge: "Challenge",
    reportColumnCode: "Code",
    reportColumnP50: "p50 duration",
    reportColumnP95: "p95 duration",
    reportColumnProxy: "Proxy per completed",
    reportColumnCost: "Cost per completed",
    reportColumnGate: "Gate",
    reportColumnScore: "reCAPTCHA score",
    reportCostInside: "Inside the gate",
    reportCostOver: "Over the gate",
    reportRate: (rate: number) => `${String(Math.round(rate * 100))}%`,
    reportNone: "—",
    reportSeconds: (millis: number) => `${(millis / 1000).toFixed(1)} s`,
    reportMegabytes: (megabytes: number) => `${megabytes.toFixed(2)} MB`,
    reportDollars: (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`,
    reportBrowserName: (provider: string) => {
      if (provider === "browser_use") {
        return "Browser Use";
      }

      if (provider === "kernel") {
        return "Kernel";
      }

      return provider === "local" ? "Local Chrome" : provider;
    },
    reportLabPageName: (page: string) => {
      if (page === "recaptcha_v3") {
        return "reCAPTCHA v3";
      }

      if (page === "hcaptcha") {
        return "hCaptcha";
      }

      if (page === "turnstile") {
        return "Turnstile";
      }

      if (page === "form:greenhouse") {
        return "Recorded Greenhouse form";
      }

      if (page === "form:lever") {
        return "Recorded Lever form";
      }

      return page === "form:ashby" ? "Recorded Ashby form" : page;
    },
    reportLabRunHeading: "Run the lab",
    reportLabRunIntro:
      "Each session opens a browser on the lab pages. Nothing leaves Overture. Up to 200 sessions per page and browser.",
    reportLabSessionsLabel: "Sessions per page and browser",
    reportLabRun: "Run the lab",
    reportLabQueued: "The lab run is queued. Reload this page when it finishes to see its results.",
    reportLabFailed: "The lab run did not start.",
    switchesTitlePlain: "Kill switches",
    switchesTitleItalic: "and settings",
    switchesLead: "Turn Overture's work off, and tune the limits that pace it",
    settingsHeading: "Limits Overture tunes",
    settingsIntro:
      "These are the admin-tunable limits. A change here takes effect as soon as it is saved.",
    settingsValueAria: (key: string) => `Value for ${key}`,
    settingsSave: "Save",
    settingsSaved: "Saved",
    switchesHeading: "Kill switches",
    switchesIntro:
      "A switched-off scope stops Overture's work there until it is switched on again.",
    switchOn: "On",
    switchOff: "Off",
    switchSetOn: "Switch off",
    switchSetOff: "Switch on",
    switchAddHeading: "New kill switch",
    switchScopeLabel: "Scope",
    switchKeyLabel: "Name",
    switchReasonLabel: "Reason",
    switchAdd: "Add the kill switch",
    switchEmpty: "No kill switches are set.",
    catalogTitlePlain: "Catalog",
    catalogTitleItalic: "health",
    catalogLead: "How each job board source is doing",
    catalogSectionHeading: "Job board sources",
    catalogHourlyLimit: "Per-hour limit",
    catalogSwitchState: "Kill switch",
    catalogSwitchUnset: "Never set",
    catalogNotDiscovered: "The catalog has not been discovered yet.",
    catalogProbeHeading: "Personio probe",
    catalogProbeLead:
      "Reads up to twenty open Personio forms over plain HTTP, without a browser and without submitting.",
    catalogProbeRun: "Run the probe",
    catalogProbeQueued: "The probe is queued. Refresh to see its results.",
    catalogProbeEmpty: "No Personio form has been probed yet.",
    catalogProbePassed: "The probe passes.",
    catalogProbeFailed: "The probe does not pass yet.",
    catalogProbeRanAt: (at: string) => `Last probed ${at}`,
    catalogProbeSummary: (input: {
      total: number;
      readable: number;
      needsReview: number;
      unreadable: number;
      unsupported: number;
    }) =>
      `${String(input.total)} forms: ${String(input.readable)} complete, ${String(input.needsReview)} need a review, ${String(input.unreadable)} unreadable, ${String(input.unsupported)} unsupported`,
    catalogProbeOutcome: (outcome: string) =>
      ADMIN_PROBE_OUTCOME_LABELS.get(outcome) ?? "Unreadable",
    catalogDiscoveredAt: (at: string) => `Last discovered ${at}`,
    grantsTitlePlain: "Applications",
    grantsTitleItalic: "granted",
    grantsLead: "Give a user more Applications",
    grantsHeading: "Recent grants",
    grantsIntro:
      "Each grant adds to the user's Applications left as soon as it is placed. Nothing expires unless days are set.",
    grantEmpty: "No grants have been placed yet.",
    billingTitlePlain: "Billing",
    billingTitleItalic: "",
    billingLead: "Trial, renewals and expiry for each user",
    billingIntro:
      "A payment that fails pauses that user's Applications until the card is fixed. Card details are never shown here.",
    billingFilterLabel: "Show",
    billingFilters: {
      all: "All",
      trial: "Trial",
      paying: "Paying",
      paused: "Paused",
      ended: "Ended",
    },
    billingStatOnTrial: "On trial",
    billingStatPaying: "Paying",
    billingStatPaused: "Paused for payment",
    billingStatEnding: "Ending in 7 days",
    billingStatTrialHint: "Applications on the trial",
    billingStatPayingHint: "Week or Month plan",
    billingStatPausedHint: "Applications stopped",
    billingStatEndingHint: "Renewal or plan end",
    billingReconcileHeading: "Last reconciliation",
    billingReconcileNone:
      "No reconciliation has run yet. It runs every day just after midnight UTC.",
    billingReconcileCleanPill: "Clean",
    billingReconcileMismatchPill: "Mismatch",
    billingReconcileClean: (day: string, invoices: number, refunds: number) =>
      `Stripe and Overture records agree for ${day}: ${String(invoices)} paid invoices and ${String(refunds)} refunds.`,
    billingReconcileMismatch: (day: string, count: number) =>
      `${String(count)} mismatches for ${day}. The owner has been alerted.`,
    billingReconcileMore: (shown: number, total: number) =>
      `Showing the first ${String(shown)} of ${String(total)}.`,
    billingReconcileKinds: {
      invoice_without_grant: "Paid invoice with no grant",
      grant_without_invoice: "Grant with no paid invoice",
      refund_without_ledger: "Refund with no Overture record",
      ledger_without_refund: "Overture refund missing at Stripe",
      refund_ledger_missing: "Refund record with no Overture entry",
    },
    billingReconcileItem: (label: string, id: string) => `${label}: ${id}`,
    billingReconcileCrumbAdmin: "Admin",
    billingReconcileTitlePlain: "Reconciliation",
    billingReconcileLead: (day: string) =>
      `Stripe payments checked against Overture records each day. Last run: ${day}.`,
    billingReconcileCrumbLabel: "Breadcrumb",
    billingReconcileCrumbSeparator: " / ",
    billingReconcileOpen: "Open reconciliation",
    billingReconcileLeadNone:
      "Stripe payments checked against Overture records each day. The first run is just after midnight UTC.",
    billingReconcileBannerMismatchTitle: (count: number) =>
      count === 1
        ? "1 payment does not match Stripe"
        : `${String(count)} payments do not match Stripe`,
    billingReconcileBannerMismatchBody:
      "Nothing is changed automatically. Review each payment; it stays as it is until you resolve it.",
    billingReconcileReview: (count: number) =>
      count === 1 ? "Review 1 mismatch" : `Review ${String(count)} mismatches`,
    billingReconcileBannerCleanTitle: (day: string) =>
      `Stripe and Overture records agree for ${day}`,
    billingReconcileBannerCleanBody: (invoices: number, refunds: number) =>
      `${String(invoices)} paid invoices and ${String(refunds)} refunds checked. Nothing needs a review.`,
    billingReconcileBannerNoneTitle: "No reconciliation has run yet",
    billingReconcileStatChecked: "Checked",
    billingReconcileStatCheckedHint: "Payments, last run",
    billingReconcileStatMatched: "Matched",
    billingReconcileStatMatchedHint: "Recorded in Overture",
    billingReconcileStatMismatched: "Mismatched",
    billingReconcileStatMismatchedHint: "Need a review",
    billingReconcileStatOnlyStripe: "Only in Stripe",
    billingReconcileStatOnlyStripeHint: "Not recorded in Overture",
    billingReconcilePayments: "Payments",
    billingReconcileShowing: (shown: number, total: number) =>
      `Showing ${String(shown)} of ${String(total)}`,
    billingReconcileShowAll: "Show all payments",
    billingReconcileOnlyMismatches: "Showing payments that need a review",
    billingReconcileEmptyList: "No payments were checked for this day.",
    billingReconcileEmptyFiltered: "No payments need a review.",
    billingReconcileColumnPayment: "Payment",
    billingReconcileColumnUser: "User",
    billingReconcileColumnStripe: "Stripe",
    billingReconcileColumnOverture: "Overture",
    billingReconcileColumnResult: "Result",
    billingReconcileNoOwner: "—",
    billingReconcileNotInStripe: "Not in Stripe",
    billingReconcileRecorded: "Recorded",
    billingReconcileNotRecorded: "Not recorded",
    billingReconcileResults: {
      matched: "Matched",
      not_in_overture: "Not in Overture records",
      not_in_stripe: "Not in Stripe",
    },
    billingColumnUser: "User",
    billingColumnPlan: "Plan",
    billingColumnPeriod: "Period",
    billingColumnUsage: "Usage",
    billingColumnStatus: "Status",
    billingUserNameFallback: "No name yet",
    billingPlanWeek: "Week",
    billingPlanMonth: "Month",
    billingPlanTrial: "Trial",
    billingNoPlan: "No plan",
    billingUsed: (used: number, quantity: number) => `${String(used)} of ${String(quantity)} used`,
    billingLeft: (left: number) => `${String(left)} left`,
    billingEndsOn: (when: string) => `Ends ${when}`,
    billingNoPeriod: "No period",
    billingPaused: "Applications paused",
    billingEmpty: "No users match this filter.",
    billingShowing: (from: number, to: number, total: number) =>
      `Showing ${String(from)} to ${String(to)} of ${String(total)}`,
    billingPrevious: "Previous",
    billingNext: "Next",
    billingOpen: "Open",
    billingStateTrial: "Trial",
    billingStatePaying: "Paying",
    billingStateEnding: "Ends soon",
    billingStatePaused: "Paused: payment failed",
    billingStateEnded: "Ended",
    billingStateNone: "No plan",
    billingUserCrumbRoot: "Billing",
    billingUserPaymentHeading: "The payment",
    billingUserPeriodsHeading: "Renewals",
    billingUserPeriodEmpty: "No paid period yet.",
    billingUserTrialHeading: "Trial",
    billingUserUser: "User",
    billingUserPlan: "Plan",
    billingUserPeriod: "Period",
    billingUserApplications: "Applications used",
    billingUserRenews: "Renews",
    billingUserExpires: "Expires",
    billingUserPausedNote: "Paused: payment failed. Applications stop until the card is fixed.",
    billingUserRefundAction: "Refund this period",
    billingUserRefunded: "Refunded",
    billingUserNotRefundable: "Nothing to refund on this account.",
    billingRefundTitlePlain: "Refund this",
    billingRefundTitleItalic: "period",
    billingRefundLead: "Refund a paid period",
    billingRefundIntro:
      "Refunds are issued from Stripe and recorded in the audit log. Each refund needs a reason and a note.",
    billingRefundAmountLabel: "Amount",
    billingRefundFull: "Full refund",
    billingRefundFullHint: "Returned to the card on the payment",
    billingRefundPartial: "Partial refund",
    billingRefundPartialHint: "Enter an amount up to the payment",
    billingRefundAmountInput: "Amount in dollars",
    billingRefundReasonLabel: "Reason (required)",
    billingRefundNoteLabel: "Note for the audit log (required)",
    billingRefundNotePlaceholder: "What happened, in one sentence",
    billingRefundNoteHint: "Recorded with your name, the reason and the time. Users never see it.",
    billingRefundReasons: {
      charged_twice: "Charged twice",
      not_received: "Did not get the plan",
      wrong_plan: "Wrong plan",
      goodwill: "Goodwill",
      other: "Other",
    },
    billingRefundReasonPlaceholder: "Choose a reason",
    billingRefundWhatHappens: "What happens",
    billingRefundWhatHappensBody:
      "The payment goes back to Stripe. The period's unused Applications stop. Applications already sent stay sent.",
    billingRefundSubmit: "Refund the period",
    billingRefundCancel: "Cancel",
    billingRefundDone: "Refunded. The unused Applications have stopped.",
    billingRefundReplayed: "This refund was already recorded. Nothing was refunded twice.",
    billingRefundFailed: "The refund did not go through. Nothing was refunded. Try again.",
    billingRefundReasonMissing: "Choose a reason for the refund.",
    billingRefundAmountMissing: "Enter an amount in dollars.",
    billingRefundNoteMissing: "Add a note for the audit log.",
    billingRefundBack: "Back to the user",
    grantLine: (email: string, when: string) => `${email} · granted ${when}`,
    grantLineWithExpiry: (email: string, when: string, expires: string) =>
      `${email} · granted ${when} · expires ${expires}`,
    grantEmailLabel: "Email",
    grantQuantityLabel: "Applications",
    grantDaysLabel: "Days",
    grantAdd: "Grant the Applications",
    gateAccessTitle: "Not through the gate",
    gateAccessBody:
      "This screen is served behind Cloudflare Access, and no valid Access credential arrived with this request.",
    gateSignInTitle: "The admin needs you signed in",
    gateSignInBody: "Sign in with the owner's account, then come back to this screen.",
    gateSignIn: "Sign in",
    gateOwnerTitle: "Only the owner has the keys",
    gateOwnerBody: "This account is not the owner, so the admin area refuses it.",
    gatePasskeyTitle: "Assert your passkey",
    gatePasskeyBody:
      "Overture asks for a passkey assertion before the admin opens, within 12 hours.",
    gatePasskeyAdd: "Add your passkey",
    gatePasskeyAssert: "Assert your passkey",
    gatePasskeyWaiting: "Waiting for your passkey…",
    gatePasskeyFailed: "The passkey did not go through. Try it again.",
    navUsers: "Users",
    navInvites: "Invites",
    navMailHealth: "Mail health",
    mailTitlePlain: "Mail",
    mailTitleItalic: "health",
    mailLead: (days: number) =>
      `Per employer, last ${String(days)} days. Replies arrive at the forwarding address.`,
    mailRangeLabel: "Period",
    mailRange7: "7 days",
    mailRange30: "30 days",
    mailColumnEmployer: "Employer",
    mailColumnAts: "ATS",
    mailColumnSent: "Sent",
    mailColumnReplies: "Replies",
    mailColumnBounces: "Bounces",
    mailColumnReplyRate: "Reply rate",
    mailColumnStatus: "Status",
    mailEmpty: "No mail has been recorded for any employer yet.",
    mailFootnote:
      "Bounces are mail that the employer's address returned. Reply rate counts replies to the forwarding address over applications sent in the period.",
    mailAuthLine: (pass: number, fail: number, none: number) =>
      `Mail in: ${String(pass)} pass · ${String(fail)} fail · ${String(none)} unverified`,
    mailReplyRate: (rate: number) => `${String(rate)}%`,
    mailReplyRateNone: "—",
    mailAtsList: (ats: readonly string[]) => ats.join(" · "),
    mailStatusHealthy: "Healthy",
    mailStatusWatch: (bounces: number) =>
      `Watch, ${String(bounces)} ${plural(bounces, "bounce", "bounces")}`,
    mailStatusReplyAlert: "Reply alert",
    mailStatusTooFewSends: "Too few sends",
    mailAlertHeading: (employer: string) => `Reply-rate alert: ${employer}`,
    mailAlertBody: (sent: number, employer: string, since: string) =>
      `No replies in ${String(sent)} ${plural(sent, "application", "applications")} sent to ${employer} since ${since}. The alert fires under 5 percent after 10 sends. Sends continue until you pause this employer.`,
    mailDomainAlertHeading: "Domain reply-rate alert",
    mailDomainAlertBody: (sent: number, since: string) =>
      `No replies in ${String(sent)} ${plural(sent, "application", "applications")} sent since ${since}. The alert fires under 5 percent after 20 sends. Sends continue until the reply rate recovers.`,
    mailOpenEmployer: "Open employer",
    mailOpenEmployerFor: (employer: string) => `Open employer: ${employer}`,
    mailCloseEmployer: "Close employer",
    mailCloseEmployerFor: (employer: string) => `Close employer: ${employer}`,
    mailPauseEmployer: "Pause this employer",
    mailPauseEmployerFor: (employer: string) => `Pause this employer: ${employer}`,
    mailPauseReason: "Reply rate under 5 percent after 10 sends",
    mailPaused: "Employer paused",
    mailPausedFor: (employer: string) => `Employer paused: ${employer}`,
    mailPauseFailed: "That change did not go through.",
    mailExpandedApplications: (count: number) =>
      `${String(count)} ${plural(count, "application", "applications")} in this period`,
    mailExpandedSwitchOn: (reason: string) => `Kill switch on · ${reason}`,
    mailExpandedSwitchOff: "Kill switch not set",
    adminPill: "Admin, owner only",
    passkeyEyebrow: "Passkey",
    passkeyJustNow: "Confirmed just now",
    passkeyMinute: (minutes: number) => `Confirmed ${String(minutes)} minute ago`,
    passkeyMinutes: (minutes: number) => `Confirmed ${String(minutes)} minutes ago`,
    passkeyNote: "The admin opens only while the passkey is under 12 hours old.",
    ownerRole: "Admin",
    usersTitlePlain: "Users and",
    usersTitleItalic: "access",
    usersLead: "Owner admin · every action here is written to the admin audit",
    usersSearch: "Search name or email",
    usersInvite: "Invite someone",
    usersFilterAll: (count: number) => `All ${String(count)}`,
    usersFilterActive: (count: number) => `Active ${String(count)}`,
    usersFilterSuspended: (count: number) => `Suspended ${String(count)}`,
    usersFilterInvited: (count: number) => `Invited ${String(count)}`,
    usersColumnUser: "User",
    usersColumnStatus: "Status",
    usersColumnInvite: "Invite",
    usersColumnGrants: "Grants",
    usersColumnLastActivity: "Last activity",
    usersShowing: (shown: number, total: number) => `Showing ${String(shown)} of ${String(total)}`,
    usersPrevious: "Previous",
    usersNext: "Next",
    statusActive: "Active",
    statusSuspended: "Suspended",
    statusInvited: "Invited",
    statusPending: "Pending",
    statusAccepted: "Accepted",
    statusRevoked: "Revoked",
    inviteAcceptedAt: (date: string) => `Accepted ${date}`,
    inviteInvitedAt: (date: string) => `Invited ${date}`,
    inviteNone: "—",
    grantsLeft: (count: number) => `${String(count)} left`,
    grantsNone: "No grant yet",
    grantsStarts: "Starts at first sign-in",
    grantAdminEnds: (date: string) => `Admin grant, ends ${date}`,
    grantAdminEnded: (date: string) => `Admin grant, ended ${date}`,
    grantAdminOpen: "Admin grant",
    lastActivityNever: "Never",
    todayAt: (time: string) => `Today, ${time}`,
    dateAt: (date: string, time: string) => `${date}, ${time}`,
    userBreadcrumb: "Users",
    breadcrumbSlash: "/",
    userJoined: (email: string, date: string) => `${email} · joined ${date}`,
    userTargetsText: (roles: readonly string[], locations: readonly string[]) => {
      const rolesText = `${roles.join(" and ")} roles`;

      return locations.length === 0 ? rolesText : `${rolesText}, ${locations.join(" and ")}`;
    },
    userAccepted: (date: string) => `Accepted by sign-in, ${date}`,
    userReveal: "Reveal support access",
    accountHeading: "Account",
    accountEmail: "Email",
    accountForwarding: "Forwarding address",
    accountForwardingNote: "Read-only. Forward ATS mail here only.",
    accountNoForwarding: "No forwarding address yet.",
    accountResume: "Resume",
    accountResumeUploaded: (date: string) => `Uploaded ${date}`,
    accountNoResume: "No resume yet.",
    accountTargets: "Targets",
    accountNoTargets: "No targets yet.",
    accountLastActivity: "Last activity",
    userGrantsHeading: "Grants",
    grantAdminTitle: "Admin grant",
    grantLeftOf: (total: number) => `of ${String(total)} left`,
    grantNoGrant: "No grant yet.",
    grantSummary: (quantity: number, days: number, start: string, end: string, used: number) =>
      `${String(quantity)} applications over ${String(days)} days, ${start} to ${end} · ${String(used)} used · no card`,
    statSent: "Sent this week",
    statReady: "Ready to send",
    statFailed: "Couldn't apply",
    statReviews: "Reviews open",
    suspendHeading: "Suspend account",
    suspendIntro:
      "Suspending stops new applications from going out. Sent applications stay sent, and Inbox mail keeps arriving. The reason is written to the admin audit.",
    suspendReason: "Reason",
    suspendPlaceholder: "Why this account is suspended",
    suspendAction: "Suspend account",
    suspendCancel: "Cancel",
    reinstateHeading: "Reinstate account",
    reinstateIntro:
      "Reinstating lets this person sign in again. Running stays paused until they start it.",
    reinstatePlaceholder: "Why this account is reinstated",
    reinstateAction: "Reinstate account",
    suspendFailed: "That change did not go through.",
    invitesTitlePlain: "Invites",
    invitesLead: (quantity: number, days: number) =>
      `Each accepted invite gives ${String(quantity)} applications over ${String(days)} days, with no card`,
    inviteFormHeading: "Invite by email",
    inviteFormIntro:
      "The first verified sign-in with this email accepts the invite, by any method, and creates the account with one admin grant.",
    inviteEmailLabel: "Email address",
    inviteEmailPlaceholder: "name@example.com",
    inviteCreate: "Create invite",
    inviteCreateFailed:
      "That invite did not go through. It may already exist, or belong to an account.",
    pendingHeading: (count: number) => `Pending · ${String(count)}`,
    acceptedHeading: (count: number) => `Accepted · ${String(count)}`,
    revokedHeading: (count: number) => `Revoked · ${String(count)}`,
    inviteColumnEmail: "Email",
    inviteColumnState: "State",
    inviteColumnDate: "Date",
    inviteColumnAction: "Action",
    inviteColumnGrant: "Grant",
    inviteColumnNote: "Note",
    inviteRevoke: "Revoke",
    inviteSignedInAt: (date: string) => `Signed in ${date}`,
    inviteRevokedAt: (date: string) => `Revoked ${date}`,
    inviteGrantLine: (quantity: number, days: number) =>
      `Grant ${String(quantity)} · ${String(days)} days`,
    inviteRevokedNote: "Never signed in",
    invitesEmpty: "No invites yet.",
  },
} as const;
