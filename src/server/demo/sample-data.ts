import type { applications } from "../platform/db/schema.ts";

import { demoLoginEmail } from "../../shared/demo.ts";

export interface DemoCompany {
  key: string;
  name: string;
  domain: string;
  ats: "greenhouse" | "lever" | "ashby";
  boardToken: string;
}

export const DEMO_COMPANIES: readonly DemoCompany[] = [
  {
    ats: "greenhouse",
    boardToken: "lumenorchard",
    domain: "lumen-orchard.example.com",
    key: "lumen",
    name: "Lumen Orchard",
  },
  {
    ats: "lever",
    boardToken: "paperkite",
    domain: "paper-kite.example.com",
    key: "paper",
    name: "Paper Kite",
  },
  {
    ats: "ashby",
    boardToken: "quarrynine",
    domain: "quarry-nine.example.com",
    key: "quarry",
    name: "Quarry Nine",
  },
  {
    ats: "greenhouse",
    boardToken: "saffronworks",
    domain: "saffron-works.example.com",
    key: "saffron",
    name: "Saffron Works",
  },
  {
    ats: "lever",
    boardToken: "tidepool",
    domain: "tidepool.example.com",
    key: "tidepool",
    name: "Tidepool Analytics",
  },
  {
    ats: "ashby",
    boardToken: "umbrahealth",
    domain: "umbra-health.example.com",
    key: "umbra",
    name: "Umbra Health",
  },
  {
    ats: "greenhouse",
    boardToken: "vinevale",
    domain: "vine-vale.example.com",
    key: "vine",
    name: "Vine & Vale",
  },
  {
    ats: "lever",
    boardToken: "willowsystems",
    domain: "willow-systems.example.com",
    key: "willow",
    name: "Willow Systems",
  },
  {
    ats: "ashby",
    boardToken: "yonderfreight",
    domain: "yonder-freight.example.com",
    key: "yonder",
    name: "Yonder Freight",
  },
  {
    ats: "greenhouse",
    boardToken: "zephyrgames",
    domain: "zephyr-games.example.com",
    key: "zephyr",
    name: "Zephyr Games",
  },
] as const;

export interface DemoApplication {
  id: string;
  company: string;
  title: string;
  status: (typeof applications.$inferSelect)["status"];
  stage: (typeof applications.$inferSelect)["stage"];
  ageDays: number;
  sentDaysAgo?: number;
  score?: number;
  closedReason?: (typeof applications.$inferSelect)["closedReason"];
  statusReason?: string;
  questions?: "form" | "none";
}

export const DEMO_APPLICATIONS: readonly DemoApplication[] = [
  {
    ageDays: 1,
    company: "lumen",
    id: "demo-app-01",
    questions: "form",
    score: 88,
    stage: "ready",
    status: "ready",
    title: "Senior Backend Engineer",
  },
  {
    ageDays: 2,
    company: "paper",
    id: "demo-app-02",
    questions: "form",
    score: 82,
    stage: "ready",
    status: "ready",
    title: "Platform Engineer",
  },
  {
    ageDays: 3,
    company: "quarry",
    id: "demo-app-03",
    questions: "none",
    score: 85,
    stage: "ready",
    status: "approved",
    title: "Staff Software Engineer",
  },
  {
    ageDays: 4,
    company: "saffron",
    id: "demo-app-04",
    score: 74,
    stage: "queued",
    status: "needs_review",
    title: "Backend Engineer",
  },
  {
    ageDays: 0,
    company: "tidepool",
    id: "demo-app-05",
    score: 79,
    stage: "queued",
    status: "preparing",
    title: "Data Engineer",
  },
  {
    ageDays: 0,
    company: "umbra",
    id: "demo-app-06",
    score: 83,
    stage: "ready",
    status: "sending",
    title: "Senior Backend Engineer",
  },
  {
    ageDays: 1,
    company: "vine",
    id: "demo-app-07",
    score: 80,
    sentDaysAgo: 0.08,
    stage: "ready",
    status: "confirming",
    title: "Platform Engineer",
  },
  {
    ageDays: 3,
    company: "willow",
    id: "demo-app-08",
    score: 87,
    sentDaysAgo: 3,
    stage: "applied",
    status: "sent",
    title: "Backend Engineer",
  },
  {
    ageDays: 10,
    company: "yonder",
    id: "demo-app-09",
    score: 81,
    sentDaysAgo: 10,
    stage: "applied",
    status: "sent",
    title: "Platform Engineer",
  },
  {
    ageDays: 20,
    company: "zephyr",
    id: "demo-app-10",
    score: 78,
    sentDaysAgo: 20,
    stage: "applied",
    status: "sent",
    title: "Senior Software Engineer",
  },
  {
    ageDays: 40,
    company: "lumen",
    id: "demo-app-11",
    score: 84,
    sentDaysAgo: 40,
    stage: "applied",
    status: "sent",
    title: "Staff Backend Engineer",
  },
  {
    ageDays: 60,
    company: "paper",
    id: "demo-app-12",
    score: 76,
    sentDaysAgo: 60,
    stage: "applied",
    status: "sent",
    title: "Infrastructure Engineer",
  },
  {
    ageDays: 95,
    company: "quarry",
    id: "demo-app-13",
    score: 79,
    sentDaysAgo: 95,
    stage: "applied",
    status: "sent",
    title: "Backend Engineer",
  },
  {
    ageDays: 25,
    company: "saffron",
    id: "demo-app-14",
    score: 86,
    sentDaysAgo: 25,
    stage: "screening",
    status: "sent",
    title: "Senior Backend Engineer",
  },
  {
    ageDays: 50,
    company: "tidepool",
    id: "demo-app-15",
    score: 88,
    sentDaysAgo: 50,
    stage: "interviewing",
    status: "sent",
    title: "Platform Engineer",
  },
  {
    ageDays: 70,
    company: "umbra",
    id: "demo-app-16",
    score: 90,
    sentDaysAgo: 70,
    stage: "offer",
    status: "sent",
    title: "Staff Software Engineer",
  },
  {
    ageDays: 80,
    company: "vine",
    id: "demo-app-17",
    closedReason: "rejected",
    score: 72,
    sentDaysAgo: 80,
    stage: "closed",
    status: "sent",
    title: "Backend Engineer",
  },
  {
    ageDays: 110,
    company: "willow",
    id: "demo-app-18",
    closedReason: "no_response",
    score: 75,
    sentDaysAgo: 110,
    stage: "closed",
    status: "sent",
    title: "Data Engineer",
  },
  {
    ageDays: 6,
    company: "yonder",
    id: "demo-app-19",
    score: 71,
    stage: null,
    status: "failed",
    statusReason: "provider_error",
    title: "Platform Engineer",
  },
  {
    ageDays: 12,
    company: "zephyr",
    id: "demo-app-20",
    score: 77,
    stage: null,
    status: "skipped",
    statusReason: "posting_closed",
    title: "Senior Backend Engineer",
  },
  {
    ageDays: 8,
    company: "lumen",
    id: "demo-app-21",
    closedReason: "withdrawn",
    score: 80,
    stage: null,
    status: "withdrawn",
    title: "Backend Engineer",
  },
] as const;

export const DEMO_FACTS: readonly { key: string; scope?: string; value: string }[] = [
  { key: "legal_name", value: "Sam Rivera" },
  { key: "email", value: demoLoginEmail },
  { key: "phone", value: "+1 555 0100" },
  { key: "current_city", value: "Toronto" },
  { key: "current_country", value: "Canada" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/sam-rivera-example" },
  { key: "current_job_title", value: "Senior Backend Engineer" },
  { key: "work_auth", scope: "CA", value: "Yes, I can work in Canada without sponsorship." },
  { key: "work_auth", scope: "US", value: "No, I would need sponsorship." },
  { key: "notice_period", value: "Two weeks" },
  { key: "earliest_start", value: "In two weeks" },
  { key: "willing_relocate", value: "Yes" },
  { key: "years_total", value: "9" },
  { key: "degree_highest", value: "BSc Computer Science" },
  { key: "employment_history", value: "Bluefin Robotics, 2019–2026; Cedar & Co, 2016–2019" },
  { key: "education_history", value: "BSc Computer Science, University of Waterloo, 2016" },
  { key: "current_employer", value: "Bluefin Robotics" },
  { key: "how_did_you_hear", value: "LinkedIn" },
  { key: "languages", value: "English, French" },
  { key: "preferred_name", value: "Sam" },
];

export const DEMO_FORM_QUESTIONS: readonly {
  text: string;
  fieldType: "text";
  factKey: string;
}[] = [
  { factKey: "legal_name", fieldType: "text", text: "Full name" },
  { factKey: "years_total", fieldType: "text", text: "Years of experience" },
  { factKey: "notice_period", fieldType: "text", text: "Notice period" },
];

export const DEMO_INBOX: readonly {
  applicationId: string;
  classification: "ack" | "code" | "rejection" | "screening" | "interview" | "offer" | "other";
  daysAgo: number;
  from: string;
  senderDomain: string;
  subject: string;
  text: string;
}[] = [
  {
    applicationId: "demo-app-08",
    classification: "ack",
    daysAgo: 3,
    from: "Willow Systems Recruiting <careers@willow-systems.example.com>",
    senderDomain: "willow-systems.example.com",
    subject: "We received your application — Backend Engineer",
    text: "Thanks for applying to Willow Systems. Your application is with the hiring team.",
  },
  {
    applicationId: "demo-app-14",
    classification: "screening",
    daysAgo: 22,
    from: "Saffron Works Talent <talent@saffron-works.example.com>",
    senderDomain: "saffron-works.example.com",
    subject: "Next step: a short screening call",
    text: "We would like to book a 30-minute screening call with you this week.",
  },
  {
    applicationId: "demo-app-15",
    classification: "interview",
    daysAgo: 44,
    from: "Tidepool Analytics <hiring@tidepool.example.com>",
    senderDomain: "tidepool.example.com",
    subject: "Interview invitation — Platform Engineer",
    text: "The panel would like to meet you on Thursday at 14:00 Eastern. Does that work?",
  },
  {
    applicationId: "demo-app-16",
    classification: "offer",
    daysAgo: 12,
    from: "Umbra Health People <people@umbra-health.example.com>",
    senderDomain: "umbra-health.example.com",
    subject: "Your offer from Umbra Health",
    text: "We are delighted to send you an offer for the Staff Software Engineer role. The letter is attached.",
  },
  {
    applicationId: "demo-app-17",
    classification: "rejection",
    daysAgo: 30,
    from: "Vine & Vale Recruiting <jobs@vine-vale.example.com>",
    senderDomain: "vine-vale.example.com",
    subject: "Update on your application",
    text: "Thank you for your time. We have decided to move forward with other candidates.",
  },
  {
    applicationId: "demo-app-11",
    classification: "other",
    daysAgo: 35,
    from: "Lumen Orchard <no-reply@lumen-orchard.example.com>",
    senderDomain: "lumen-orchard.example.com",
    subject: "A note from the team",
    text: "Our process is taking a little longer than usual. Thanks for your patience.",
  },
];

export const DEMO_NOTIFICATIONS: readonly {
  atDaysAgo: number;
  body: string;
  kind: string;
  read: boolean;
  title: string;
  url: string;
}[] = [
  {
    atDaysAgo: 0,
    body: "2 ready to approve, 2 need an answer",
    kind: "ready",
    read: false,
    title: "Two applications are ready",
    url: "/ready",
  },
  {
    atDaysAgo: 1,
    body: "Two questions need an answer before Overture can prepare more applications.",
    kind: "review",
    read: false,
    title: "Your answers open four jobs",
    url: "/review",
  },
  {
    atDaysAgo: 2,
    body: "Saffron Works replied to your application.",
    kind: "reply",
    read: false,
    title: "Saffron Works replied",
    url: "/",
  },
  {
    atDaysAgo: 12,
    body: "Umbra Health sent an offer for Staff Software Engineer.",
    kind: "offer",
    read: true,
    title: "An offer arrived",
    url: "/board",
  },
  {
    atDaysAgo: 22,
    body: "Saffron Works moved to Screening.",
    kind: "stage_move",
    read: true,
    title: "Moved to Screening",
    url: "/board",
  },
  {
    atDaysAgo: 19,
    body: "It has been three weeks since you applied to Lumen Orchard.",
    kind: "checkin",
    read: true,
    title: "How did Lumen Orchard go?",
    url: "/",
  },
];
